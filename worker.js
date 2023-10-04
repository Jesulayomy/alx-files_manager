/* eslint-disable import/no-named-as-default */
import { writeFile } from 'fs';
import { promisify } from 'util';
import Queue from 'bull/lib/queue';
import imgThumbnail from 'image-thumbnail';
import mongoDBCore from 'mongodb/lib/core';
import dbClient from './utils/db';
import Mailer from './utils/mailer';

const writeFileAsync = promisify(writeFile);
const fileQueue = new Queue('Thumbnail generation');
const userQueue = new Queue('Email sending');

const genThumbnail = async (filePath, size) => {
  const buff = await imgThumbnail(filePath, { width: size });
  console.log(`Generating thumbFile: ${filePath}, size: ${size}`);
  return writeFileAsync(`${filePath}_${size}`, buff);
};

fileQueue.process(async (job, done) => {
  const fileId = job.data.fileId || null;
  if (!fileId) throw new Error('Missing fileId');
  const userId = job.data.userId || null;
  if (!userId) throw new Error('Missing userId');
  console.log('Processing', job.data.name || '');

  const file = await (
    await dbClient.filesCollection()
  ).findOne({
    _id: new mongoDBCore.BSON.ObjectId(fileId),
    userId: new mongoDBCore.BSON.ObjectId(userId)
  });

  if (!file) throw new Error('File not found');
  const sizes = [500, 250, 100];

  Promise.all(sizes.map((size) => genThumbnail(file.localPath, size))).then(
    () => {
      done();
    }
  );
});

userQueue.process(async (job, done) => {
  const userId = job.data.userId || null;
  if (!userId) throw new Error('Missing userId');

  const user = await (
    await dbClient.usersCollection()
  ).findOne({
    _id: new mongoDBCore.BSON.ObjectId(userId)
  });
  if (!user) throw new Error('User not found');
  console.log(`Welcome ${user.email}!`);
  try {
    const subject = '[Intro]: Welcome to Files_manager';
    const body = [
      '<div>',
      '<h3>Hello {{user.name}},</h3>',
      'Welcome to <a href="https://github.com/jesulayomy/alx-files_manager">',
      'ALX-Files_Manager</a>, ',
      'a simple file management API built with Node.js by ',
      '<a href="https://github.com/jesulayomy">Jesulayomi</a>. ',
      'Use responsibly.',
      '</div>'
    ].join('');
    Mailer.sendMail(Mailer.buildMessage(user.email, subject, body));
    done();
  } catch (err) {
    done(err);
  }
});

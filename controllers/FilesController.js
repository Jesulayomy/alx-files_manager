import fs from 'fs';
import mime from 'mime-types';
import mongoDBCore from 'mongodb/lib/core';
import Queue from 'bull/lib/queue';
import { v4 as uuid } from 'uuid';

import dbClient from '../utils/db';
import redisClient from '../utils/redis';

const fileQueue = new Queue('fileQueue');

export default class FilesController {
  static async postUpload(request, response) {
    const token = request.header('X-Token');
    if (!token) return response.status(401).send({ error: 'Unauthorized' });
    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) return response.status(401).send({ error: 'Unauthorized' });

    const { name, type } = request.body;
    let { parentId, isPublic, data } = request.body;
    const types = ['file', 'folder', 'image'];

    if (!name) return response.status(400).send({ error: 'Missing name' });
    if (!type || !types.includes(type)) {
      return response.status(400).send({ error: 'Missing type' });
    }
    if (!data && type !== 'folder') {
      return response.status(400).send({ error: 'Missing data' });
    }
    if (data) {
      data = Buffer.from(data, 'base64').toString('utf-8');
    }
    if (!parentId) parentId = 0;
    if (!isPublic) isPublic = false;
    const filename = uuid();
    let localPath;
    console.log('Values checked and approved');

    // Folder here is a file with type set to 'folder'
    if (parentId !== 0) {
      const folder = await (
        await dbClient.filesCollection()
      ).findOne({ _id: new mongoDBCore.BSON.ObjectId(parentId) });
      if (!folder) {
        return response.status(400).send({ error: 'Parent not found' });
      }
      if (folder && folder.type !== 'folder') {
        return response.status(400).send({ error: 'Parent is not a folder' });
      }
      fs.mkdir(folder.localPath, { recursive: true }, (err) => {
        if (err) {
          if (err.code !== 'EEXIST') {
            console.log(err);
          }
        }
      });
      localPath = `${folder.localPath}/${filename}`;
    } else {
      localPath = process.env.FOLDER_PATH || '/tmp/files_manager';
      fs.mkdir(localPath, { recursive: true }, (err) => {
        if (err) {
          if (err.code !== 'EEXIST') {
            console.log(err);
          }
        }
      });
      localPath = `${localPath}/${filename}`;
    }

    // add file or folder to the database
    const file = await (
      await dbClient.filesCollection()
    ).insertOne({
      userId: new mongoDBCore.BSON.ObjectId(userId),
      name,
      type,
      isPublic,
      parentId,
      localPath,
    });

    // Create file or folder locally
    if (type !== 'folder') {
      if (type === 'image') {
        const fileId = file.insertedId;
        fileQueue.add({ userId, fileId });
      }
      // fs.mkdir(localPath, { recursive: true }, (err) => {
      //   if (err) {
      //     if (err.code !== 'EEXIST') {
      //       console.log(err);
      //     }
      //   }
      // });
      fs.writeFile(localPath, data, 'utf-8', (err) => {
        if (err) {
          console.log(err);
        }
      });
    } else {
      fs.mkdir(localPath, { recursive: true }, (err) => {
        if (err) {
          if (err.code !== 'EEXIST') {
            console.log('Error:', err);
          }
        }
      });
    }

    return response.status(201).send({
      id: file.insertedId,
      userId: file.ops[0].userId,
      name: file.ops[0].name,
      type: file.ops[0].type,
      isPublic: file.ops[0].isPublic,
      parentId: file.ops[0].parentId,
    });
  }

  static async getShow(request, response) {
    const token = request.header('X-Token');
    if (!token) return response.status(401).send({ error: 'Unauthorized' });
    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) return response.status(401).send({ error: 'Unauthorized' });
    const { id } = request.params;

    const document = await (
      await dbClient.filesCollection()
    ).findOne({
      _id: mongoDBCore.BSON.ObjectId(id),
      userId: mongoDBCore.BSON.ObjectId(userId),
    });
    if (!document) return response.status(404).send({ error: 'Not found' });

    return response.status(200).send({
      id: document._id,
      userId: document.userId,
      name: document.name,
      type: document.type,
      isPublic: document.isPublic,
      parentId: document.parentId,
    });
  }

  static async getIndex(request, response) {
    const token = request.header('X-Token');
    if (!token) return response.status(401).send({ error: 'Unauthorized' });
    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) return response.status(401).send({ error: 'Unauthorized' });

    const parentId = request.query.parentId || 0;
    const page = request.query.page || '0';

    const pipeline = [
      { $skip: Number(page) * 20 },
      { $limit: 20 },
    ];
    if (parentId && parentId !== 0) {
      pipeline.unshift({ $match: { parentId } });
    }
    const files = await (await dbClient.filesCollection())
      .aggregate(pipeline)
      .toArray();
    return response.status(200).send(
      files.map(({
        _id, userId, name, type, isPublic, parentId,
      }) => ({
        id: _id,
        userId,
        name,
        type,
        isPublic,
        parentId,
      })),
    );
  }

  static async putPublish(request, response) {
    const token = request.header('X-Token');
    if (!token) return response.status(401).send({ error: 'Unauthorized' });
    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) return response.status(401).send({ error: 'Unauthorized' });
    const { id } = request.params;

    const document = await (await dbClient.filesCollection())
      .findOneAndUpdate(
        { _id: mongoDBCore.BSON.ObjectId(id), userId: mongoDBCore.BSON.ObjectId(userId) },
        { $set: { isPublic: true } },
      )
      .catch((err) => {
        console.log(err);
      });
    if (!document || document.value === null) return response.status(404).send({ error: 'Not found' });

    return response.status(200).send({
      id: document.value._id,
      userId: document.value.userId,
      name: document.value.name,
      type: document.value.type,
      isPublic: true,
      parentId: document.value.parentId,
    });
  }

  static async putUnPublish(request, response) {
    const token = request.header('X-Token');
    if (!token) return response.status(401).send({ error: 'Unauthorized' });
    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) return response.status(401).send({ error: 'Unauthorized' });
    const { id } = request.params;

    const document = await (await dbClient.filesCollection())
      .findOneAndUpdate(
        { _id: mongoDBCore.BSON.ObjectId(id), userId: mongoDBCore.BSON.ObjectId(userId) },
        { $set: { isPublic: false } },
      )
      .catch((err) => {
        console.log(err);
      });
    if (!document || document.value === null) return response.status(404).send({ error: 'Not found' });

    return response.status(200).send({
      id: document.value._id,
      userId: document.value.userId,
      name: document.value.name,
      type: document.value.type,
      isPublic: false,
      parentId: document.value.parentId,
    });
  }

  static async getFile(request, response) {
    const token = request.header('X-Token');
    if (!token) return response.status(401).send({ error: 'Unauthorized' });
    const userId = await redisClient.get(`auth_${token}`);
    const { id } = request.params;

    const document = await (
      await dbClient.filesCollection()
    ).findOne({
      _id: mongoDBCore.BSON.ObjectId(id),
    });
    if (!document) return response.status(404).send({ error: 'Not found DOC' });

    if (!document.isPublic && document.userId !== userId) {
      return response.status(404).send({ error: 'Not found UserID' });
    }
    if (document.type === 'folder') {
      return response.status(400).send({ error: 'A folder doesn\'t have content' });
    }
    if (!fs.existsSync(document.localPath)) {
      return response.status(404).send({ error: 'Not found File' });
    }

    let { size } = request.query;
    if (!size) size = '';

    try {
      const path = document.localPath;
      const mimeType = mime.lookup(document.name);
      response.setHeader('Content-Type', mimeType);
      return response.status(200).sendFile(path);
    } catch (err) {
      console.log('Not found error reading', err);
      return response.status(404).send({ error: 'Not found' });
    }
  }
}

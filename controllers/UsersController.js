import mongoDBCore from 'mongodb/lib/core';
import Queue from 'bull/lib/queue';
import sha1 from 'sha1';

import dbClient from '../utils/db';
import redisClient from '../utils/redis';

const userQueue = new Queue('userQueue');

export default class UsersController {
  static async postNew(request, response) {
    const { email, password } = request.body;
    console.log(email, password);
    if (!email) return response.status(400).send({ error: 'Missing email' });
    if (!password) return response.status(400).send({ error: 'Missing password' });
    const user = await (await dbClient.usersCollection()).findOne({ email });
    if (user) return response.status(400).send({ error: 'Already exist' });
    const shaOnePassword = sha1(password);
    const result = await (await dbClient.usersCollection())
      .insertOne({ email, password: shaOnePassword });
    userQueue.add({ userId: result.insertedId.toString() });
    return response.status(201).send({ id: result.insertedId.toString(), email });
  }

  static async getMe(request, response) {
    const token = request.header('X-Token');
    if (!token) return response.status(401).send({ error: 'Unauthorized' });
    const userId = await redisClient.get(`auth_${token}`);
    const user = await (await dbClient.usersCollection())
      .findOne({ _id: new mongoDBCore.BSON.ObjectId(userId) });
    if (!user) return response.status(401).send({ error: 'Unauthorized' });
    return response.status(200).send({ id: user._id, email: user.email });
  }
}

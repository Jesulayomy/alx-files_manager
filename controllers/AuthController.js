import redisClient from '../utils/redis';
import dbClient from '../utils/db';
import sha1 from 'sha1';
import { v4 as uuid } from 'uuid';

export default class AuthController {
  static async getConnect (request, response) {
    const auth = request.header('Authorization') || '';
    const buff = Buffer.from(auth.replace('Basic ', ''), 'base64');
    const credentials = {
      email: buff.toString('utf-8').split(':')[0],
      password: buff.toString('utf-8').split(':')[1]
    };
    if (!credentials.email || !credentials.password) return response.status(401).send({ error: 'Unauthorized' });
    const user = await (await dbClient.usersCollection()).findOne({ email: credentials.email });
    if (!user) return response.status(401).send({ error: 'Unauthorized' });
    if (sha1(credentials.password) !== user.password) return response.status(401).send({ error: 'Unauthorized' });
    const token = uuid();
    const key = `auth_${token}`;
    await redisClient.set(key, user._id.toString(), 24 * 60 * 60);
    return response.status(200).send({ token: token });
  }

  static async getDisconnect (request, response) {
    const token = request.header('X-Token');
    if (!token) return response.status(401).send({ error: 'Unauthorized' });
    const key = `auth_${token}`;
    const userId = await redisClient.get(key);
    if (!userId) return response.status(401).send({ error: 'Unauthorized' });
    await redisClient.del(key);
    return response.status(204).send();
  }
}

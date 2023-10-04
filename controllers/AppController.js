import dbClient from '../utils/db';
import redisClient from '../utils/redis';

export default class AppController {
  static getStatus(request, response) {
    response.status(200);
    response.send({ redis: redisClient.isAlive(), db: dbClient.isAlive() });
  }

  static getStats(request, response) {
    Promise.all([dbClient.nbUsers(), dbClient.nbFiles()])
      .then(([usersCount, filesCount]) => {
        response.status(200).json({ users: usersCount, files: filesCount });
      })
      .catch((err) => {
        response.status(500).json({ error: err.message });
      });
  }
}

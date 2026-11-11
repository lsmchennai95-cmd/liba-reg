import mysql from 'mysql2/promise';
import { env } from './env.js';

let pool = null;

export const getPool = () => {
  if (!pool) {
    pool = mysql.createPool({
      host: env.db.host,
      port: env.db.port,
      user: env.db.user,
      password: env.db.password,
      database: env.db.database,
      waitForConnections: env.db.waitForConnections,
      connectionLimit: env.db.connectionLimit,
      queueLimit: env.db.queueLimit,
      decimalNumbers: env.db.decimalNumbers,
      timezone: '+00:00',
      dateStrings: true
    });
  }
  return pool;
};

export const query = async (sql, params = []) => {
  const connectionPool = getPool();
  const [rows] = await connectionPool.execute(sql, params);
  return rows;
};

export const getConnection = async () => {
  const connectionPool = getPool();
  return connectionPool.getConnection();
};

export const testConnection = async () => {
  console.log('Testing MySQL connection...');
  console.log(`Host: ${env.db.host}:${env.db.port} | Database: ${env.db.database} | User: ${env.db.user}`);
  try {
    const connectionPool = getPool();
    const [rows] = await connectionPool.query('SELECT 1 as is_alive, NOW() as db_time');
    console.log('MySQL Connection Successful!', rows[0]);
    return true;
  } catch (error) {
    const errorMsg = error.message || error.code || (error.errors && error.errors[0]?.message) || String(error);
    console.error('MySQL Connection Failed:', errorMsg);
    if (error.code === 'ECONNREFUSED' || (error.errors && error.errors.some(e => e.code === 'ECONNREFUSED'))) {
      console.error(`-> MySQL service is not running on ${env.db.host}:${env.db.port}. Please start MySQL in Laragon or your MySQL service.`);
    }
    return false;
  }
};


import Dexie from 'dexie';

export const db = new Dexie('myDatabase');
db.version(1).stores({
  users: 'id, name, accessToken', // Primary key and indexed props
});
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync('/data/data/com.termux/files/home/crediq/serviceAccountKey.json','utf8'));
initializeApp({credential: cert(sa)});
getAuth().updateUser('j1bHUEcnzIXpJ4A69NaWBHZioKn1', {emailVerified: true})
  .then(u => console.log('✓ Verified:', u.email))
  .catch(e => console.error(e));

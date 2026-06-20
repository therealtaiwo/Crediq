// ─── CREDIQ FIREBASE CONFIG ───────────────────────────────────────────────────
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getAnalytics, logEvent } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyAeCG7SG14uzJL3J2QTj7JyVuZfNPJOJYg",
  authDomain: "crediq-jupeb.firebaseapp.com",
  projectId: "crediq-jupeb",
  storageBucket: "crediq-jupeb.firebasestorage.app",
  messagingSenderId: "1033906209085",
  appId: "1:1033906209085:web:2879d6e294180d23a68554",
  measurementId: "G-8BL2R2PWSC"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const analytics = getAnalytics(app);

// ─── ANALYTICS HELPER ─────────────────────────────────────────────────────────
// Call track() anywhere in the app to log user behaviour
// This is the data that makes CrediQ defensible over time
export const track = (event, params = {}) => {
  try {
    logEvent(analytics, event, { ...params, timestamp: Date.now() });
  } catch (e) {
    // Never crash the app for analytics
  }
};

// Events to track (use these strings in track() calls throughout the app):
// "signup"           - new user created account
// "login"            - user logged in
// "onboard_complete" - user finished subject selection
// "exam_started"     - user started a CBT session
// "exam_completed"   - user submitted a session
// "exam_abandoned"   - user quit mid-session
// "drill_started"    - user started a drill
// "drill_completed"  - user finished a drill
// "upgrade_screen"   - user hit the premium gate
// "payment_started"  - user clicked pay
// "payment_success"  - payment confirmed (via webhook)
// "share_result"     - user shared a result card

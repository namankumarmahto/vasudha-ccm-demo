/*
  server/index.js
  Simple Express server exposing POST /api/register
  - Validates registration against Terms & Conditions rules
  - Uses SUPABASE_SERVICE_ROLE (must be set in env) to create user and insert profile
  - Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE
*/
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

if(!SUPABASE_URL || !SUPABASE_SERVICE_ROLE){
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE in environment.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, { auth: { persistSession: false }});

const app = express();
app.use(express.json());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*'
}));

const limiter = rateLimit({ windowMs: 60*1000, max: 10 });
app.use('/api/', limiter);

/*
  Terms & Conditions rules enforced by server:
  1) Role "admin" cannot self-register (must be approved by existing admin).
  2) Disposable email domains blocked (common disposable domains list).
  3) Username cannot contain offensive words (simple banned words list).
  4) For critical roles (project_owner, field_user) phone is required.
  5) Duplicate username rejected (profiles.username unique).
  6) Password minimum length enforced (8).
*/

const DISPOSABLE_DOMAINS = [
  "mailinator.com","10minutemail.com","guerrillamail.com","tempmail.com","trashmail.com",
  "tempmail.net","dispostable.com","yopmail.com","maildrop.cc"
];

const BANNED_WORDS = ["admin","moderator","root","support","test","null","undefined","fuck","shit","bitch"];

function isDisposableEmail(email){
  try {
    const domain = email.split('@')[1].toLowerCase();
    return DISPOSABLE_DOMAINS.includes(domain);
  } catch(e) { return false; }
}
function containsBannedWord(username){
  if(!username) return false;
  const s = username.toLowerCase();
  return BANNED_WORDS.some(b => s.includes(b));
}

// helper to respond
function fail(res, status, message){
  return res.status(status).json({ ok:false, error: message });
}

app.post('/api/register', async (req, res) => {
  try {
    const { first, last, email, password, phone, username, role } = req.body || {};
    if(!first || !email || !password) return fail(res, 400, 'Missing required fields: first, email, or password.');
    if(password.length < 8) return fail(res, 400, 'Password must be at least 8 characters.');
    const chosenRole = (role || 'buyer').toLowerCase();

    // rule 1: admin cannot self-register
    if(chosenRole === 'admin') return fail(res, 403, 'Registration as admin is not allowed. Contact site administrator.');

    // rule 2: disposable email
    if(isDisposableEmail(email)) return fail(res, 403, 'Disposable email addresses are not allowed. Use a permanent email.');

    // rule 3: banned words in username
    if(username && containsBannedWord(username)) return fail(res, 403, 'Username contains disallowed words. Choose a different username.');

    // rule 4: phone required for specific roles
    if((chosenRole === 'project_owner' || chosenRole === 'field_user') && !phone) {
      return fail(res, 400, 'Phone number is required for the selected role.');
    }

    // rule 5: ensure username unique (if provided)
    if(username) {
      const { data: existing, error: exErr } = await supabase.from('profiles').select('id').eq('username', username).limit(1);
      if(exErr) {
        console.warn('username lookup error', exErr);
        // don't block, continue to try creating user
      } else if(existing && existing.length) {
        return fail(res, 409, 'Username already taken. Choose another.');
      }
    }

    // create user via admin API
    const { data: userData, error: userErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // mark as confirmed to skip email flow if desired; change if you want email verification
      user_metadata: { full_name: (first + ' ' + (last||'')).trim() }
    });

    if(userErr) {
      console.error('supabase admin.createUser error', userErr);
      // If user already exists, supabase returns an error - return a friendly message
      if(userErr?.message?.includes('duplicate key') || userErr?.status === 409) {
        return fail(res, 409, 'User with this email already exists. Login instead or reset password.');
      }
      return fail(res, 500, 'Failed to create user: ' + (userErr.message || 'unknown'));
    }

    const user = userData || null;
    if(!user || !user.id) return fail(res, 500, 'User creation did not return an id.');

    // insert profile row
    const full_name = (first + ' ' + (last||'')).trim();
    const { error: profErr } = await supabase.from('profiles').insert([{
      id: user.id,
      full_name,
      username: username || null,
      phone: phone || null,
      role: chosenRole
    }]);

    if(profErr) {
      console.error('profile insert error', profErr);
      // rollback: delete created user
      try { await supabase.auth.admin.deleteUser(user.id); } catch(e){ console.warn('rollback delete failed', e); }
      return fail(res, 500, 'Failed to save profile. Registration rolled back. Contact admin.');
    }

    return res.json({ ok:true, message: 'Registration successful. You may login now.' });
  } catch(err){
    console.error('register handler error', err);
    return fail(res, 500, 'Internal server error');
  }
});

// health
app.get('/health', (req,res) => res.json({ ok:true }));

const PORT = process.env.PORT || 8787;
app.listen(PORT, ()=> console.log('Server listening on', PORT));

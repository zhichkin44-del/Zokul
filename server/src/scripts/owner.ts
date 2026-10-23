import { pool } from '../config/db';
import { logEvent } from '../services/auditService';

// Server-side owner management. There is deliberately no web UI for this:
// only someone with shell access to the server can change who the owner is.
//
//   docker compose exec server node dist/scripts/owner.js status
//   docker compose exec server node dist/scripts/owner.js transfer <email>
//   docker compose exec server node dist/scripts/owner.js reset-2fa
//
// Every change signs the affected people out everywhere (token_version + 1)
// and makes the owner set up two-factor sign-in again.

const RESET_2FA = `totp_secret = NULL, totp_pending = NULL, totp_enabled = false,
  totp_last_step = NULL, totp_recovery = NULL, token_version = token_version + 1`;

async function status() {
  const r = await pool.query(`SELECT email, name, totp_enabled FROM users WHERE role = 'admin'`);
  if (!r.rows[0]) return console.log('No owner yet. The first person to register becomes the owner.');
  const o = r.rows[0];
  console.log(`Owner: ${o.name} <${o.email}>, two-factor sign-in: ${o.totp_enabled ? 'on' : 'not set up yet'}`);
}

async function transfer(email: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const target = await client.query(
      `SELECT id, role FROM users WHERE lower(email) = lower($1) AND is_agent = false AND blocked = false`,
      [email]
    );
    if (!target.rows[0]) throw new Error(`No active person with email ${email}`);
    if (target.rows[0].role === 'admin') throw new Error(`${email} is already the owner`);
    const old = await client.query(`UPDATE users SET role = 'user', ${RESET_2FA} WHERE role = 'admin' RETURNING id`);
    await client.query(`UPDATE users SET role = 'admin', ${RESET_2FA} WHERE id = $1`, [target.rows[0].id]);
    await client.query('COMMIT');
    await logEvent(target.rows[0].id, 'owner_changed', { previous: old.rows[0]?.id ?? null });
    console.log(`Done: ${email} is now the owner. They must sign in again and set up two-factor sign-in.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// For a lost phone AND lost recovery codes.
async function reset2fa() {
  const r = await pool.query(`UPDATE users SET ${RESET_2FA} WHERE role = 'admin' RETURNING id, email`);
  if (!r.rows[0]) throw new Error('No owner yet');
  await logEvent(r.rows[0].id, 'admin_2fa_reset', {});
  console.log(`Done: two-factor sign-in reset for ${r.rows[0].email}. Sign in again and set it up anew.`);
}

async function main() {
  const [command, arg] = process.argv.slice(2);
  if (command === 'status') await status();
  else if (command === 'transfer' && arg) await transfer(arg);
  else if (command === 'reset-2fa') await reset2fa();
  else {
    console.log('Usage: owner.js status | transfer <email> | reset-2fa');
    process.exitCode = 2;
  }
}

main()
  .catch((err: Error) => { console.error(`Error: ${err.message}`); process.exitCode = 1; })
  .finally(() => pool.end());

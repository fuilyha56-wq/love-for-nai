"""Install the additive PostgreSQL index needed by the admin IP history query.
Uses existing .rsh.py credentials. Does not rewrite NewAPI records.
"""
import pathlib
import shlex
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parents[1]
code = r'''
const {Pool}=require('pg');
const pool=new Pool({connectionString:process.env.NEWAPI_DB_URL,max:1,connectionTimeoutMillis:10000});
(async()=>{
 const client=await pool.connect();
 try {
  const locked=await client.query("SELECT pg_try_advisory_lock(hashtext('lfn-ip-history-index-v1')) AS acquired");
  if(!locked.rows[0].acquired)throw new Error('IP index installation is already running');
  const previous=await client.query("SELECT indisvalid FROM pg_index WHERE indexrelid=to_regclass('lfn_logs_user_created_ip')");
  if(previous.rows.length&&!previous.rows[0].indisvalid)await client.query('DROP INDEX CONCURRENTLY lfn_logs_user_created_ip');
  console.log('Creating the IP history index concurrently...');
  await client.query("CREATE INDEX CONCURRENTLY IF NOT EXISTS lfn_logs_user_created_ip ON logs (user_id,created_at) INCLUDE (ip) WHERE ip IS NOT NULL AND ip<>''");
  const valid=await client.query("SELECT indisvalid,pg_size_pretty(pg_relation_size(indexrelid)) AS size FROM pg_index WHERE indexrelid='lfn_logs_user_created_ip'::regclass");
  if(!valid.rows[0]?.indisvalid)throw new Error('IP index is not valid');
  console.log('IP_INDEX_READY',JSON.stringify(valid.rows[0]));
 }finally{await client.query("SELECT pg_advisory_unlock(hashtext('lfn-ip-history-index-v1'))");client.release();}
})().catch(e=>{console.error('IP_INDEX_FAILED',e.message);process.exitCode=1}).finally(()=>pool.end());
'''
sys.exit(subprocess.run([sys.executable, str(root / '.rsh.py'), 'docker exec love-for-nai node -e ' + shlex.quote(code)]).returncode)

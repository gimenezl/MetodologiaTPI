import { existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync,copyFileSync } from 'node:fs'
import path from 'node:path'

// Solo prepara archivos ignorados de un stack propio. No enlaza ni arranca cron.
const destino=path.resolve('.tmp-supabase-ept104')
if (existsSync(path.join(destino,'supabase/.temp/project-ref'))) {
  throw new Error('El directorio local está enlazado; se rechaza prepararlo.')
}
mkdirSync(path.join(destino,'supabase/migrations'),{recursive:true})
let config=readFileSync('supabase/config.toml','utf8')
config=config.replace(/^project_id\s*=.*$/mu,'project_id = "ept104"')
for(let puerto=54320;puerto<=54329;puerto++) {
  config=config.replaceAll(`= ${puerto}`,`= ${puerto+120}`)
}
config=config.replace('inspector_port = 8083','inspector_port = 8203')
config=config.replace(/\[db.seed\][\s\S]*?(?=\n\[)/u,'[db.seed]\nenabled = false\nsql_paths = []\n')
writeFileSync(path.join(destino,'supabase/config.toml'),config,'utf8')
for(const archivo of readdirSync('supabase/migrations').filter(p=>p.endsWith('.sql'))) {
  copyFileSync(path.join('supabase/migrations',archivo),path.join(destino,'supabase/migrations',archivo))
}
console.log('Stack ept104 preparado, no enlazado: API 54441, DB 54442. Sin inicio, reset ni activación.')

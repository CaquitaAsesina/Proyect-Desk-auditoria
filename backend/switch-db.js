/* =========================================================
   switch-db.js — Cambia entre MySQL local y MySQL en Aiven.
   Uso:  node switch-db.js local | aiven
   Copia el perfil elegido (.env.local o .env.aiven) a .env.
   Después hay que reiniciar el servidor (npm start).
   ========================================================= */

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const perfiles = {
    local: '.env.local',
    aiven: '.env.aiven'
};

const perfil = (process.argv[2] || '').toLowerCase();

if (!perfiles[perfil]) {
    console.log('Uso: node switch-db.js local | aiven');
    console.log('  local → MySQL de este PC (auditoria_db)');
    console.log('  aiven → MySQL en la nube (defaultdb)');
    process.exit(1);
}

const origen = path.join(DIR, perfiles[perfil]);
const destino = path.join(DIR, '.env');

if (!fs.existsSync(origen)) {
    console.error(`No existe el archivo ${perfiles[perfil]}. Créalo copiando .env y ajustando los valores.`);
    process.exit(1);
}

fs.copyFileSync(origen, destino);
console.log(`✔ Base de datos cambiada a: ${perfil.toUpperCase()}`);
console.log(`  (${perfiles[perfil]} → .env)`);
console.log('Reinicia el servidor (npm start) para aplicar el cambio.');

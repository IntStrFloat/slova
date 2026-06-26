/**
 * Патчит android/app/build.gradle после `expo prebuild`: подключает release-подпись
 * из credentials/keystore.properties (спека 14). Идемпотентно. Запуск: node scripts/patch-signing.js
 */
const fs = require('node:fs');
const path = require('node:path');

const gradlePath = path.join(__dirname, '..', 'android', 'app', 'build.gradle');
let g = fs.readFileSync(gradlePath, 'utf8');

if (g.includes('signingConfigs.release')) {
  console.log('build.gradle уже пропатчен');
  process.exit(0);
}

// 1) загрузка keystore.properties перед `android {`
const loader = `
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file("../credentials/keystore.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {`;
g = g.replace(/\nandroid \{/, loader);

// 2) release signingConfig
g = g.replace(
  /signingConfigs \{/,
  `signingConfigs {
        release {
            if (keystorePropertiesFile.exists()) {
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }`,
);

// 3) release buildType использует release-подпись
g = g.replace(/signingConfig signingConfigs\.debug/g, 'signingConfig signingConfigs.release');

fs.writeFileSync(gradlePath, g);
console.log('build.gradle пропатчен (release signing)');

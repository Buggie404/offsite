const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'src', 'environments');
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const targetPath = path.join(dir, 'environment.ts');
const apiUrl = process.env.API_URL || 'http://localhost:5000/api';

const envConfigFile = `export const environment = {
  production: ${process.env.NODE_ENV === 'production' ? 'true' : 'false'},
  apiUrl: '${apiUrl}'
};
`;

fs.writeFileSync(targetPath, envConfigFile, 'utf8');
console.log(`Environment file generated at ${targetPath} with apiUrl: ${apiUrl}`);

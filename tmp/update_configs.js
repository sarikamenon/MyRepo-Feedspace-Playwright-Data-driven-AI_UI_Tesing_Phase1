const fs = require('fs');
const path = require('path');

const configsDir = path.join(process.cwd(), 'Configs');
const files = fs.readdirSync(configsDir).filter(f => f.endsWith('.json'));

files.forEach(file => {
    const filePath = path.join(configsDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    if (data.commented_features && data.commented_features.includes('Feedspace Branding')) {
        // Remove from commented_features
        data.commented_features = data.commented_features.filter(f => f !== 'Feedspace Branding');
        
        // Add to features if not already there
        if (!data.features.includes('Feedspace Branding')) {
            data.features.push('Feedspace Branding');
        }
        
        fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
        console.log(`Updated ${file}`);
    } else {
        console.log(`Skipped ${file} (Branding not in commented_features)`);
    }
});

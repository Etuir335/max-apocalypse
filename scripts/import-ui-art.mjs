// Разовый импорт картинок интерфейса от пользователя: node scripts/import-ui-art.mjs <logo> <кнопки> <окна> <финал>
import sharp from 'sharp'

const [logo, button, sheet, end] = process.argv.slice(2)
const out = 'public/assets/ui/'

await sharp(logo).resize(512).webp({ quality: 82 }).toFile(out + 'logo.webp')
await sharp(logo).resize(192).png().toFile('public/icon-192.png')
await sharp(logo).resize(640).jpeg({ quality: 88 }).toFile('.cache/bot-avatar.jpg')
await sharp(button).resize(512).webp({ quality: 78 }).toFile(out + 'bg-button.webp')
await sharp(sheet).resize(768).webp({ quality: 78 }).toFile(out + 'bg-sheet.webp')
await sharp(end).resize(1400).webp({ quality: 80 }).toFile(out + 'end.webp')
console.log('ok')

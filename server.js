import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 5000;

// Configure Express to trust proxies and allow all hosts
app.set('trust proxy', true);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Disable caching for development
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Serve static files
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/svg', express.static(path.join(__dirname, 'svg')));

// Serve manifest.json
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(path.join(__dirname, 'manifest.json'));
});

// Supabase client - handle missing environment variables gracefully
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_API_KEY) {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_API_KEY
  );
  console.log('✅ Supabase client initialized');
} else {
  console.log('⚠️  Supabase credentials not configured - authentication features will be limited');
}

// API Routes
app.get('/api/get-secret', (req, res) => {
  // Return a base secret for anti-debug functionality
  res.json({ s: 'mobywatel-secret-base' });
});

app.get('/api/config', (req, res) => {
  // Provide client-safe configuration
  res.json({
    discord_client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: `https://${req.get('host')}/login.html`
  });
});

app.get('/api/antidebug.js', async (req, res) => {
  const fp = req.query.fp;
  
  // Simple anti-debug script
  const script = `
    console.log('Anti-debug script loaded');
    // Basic protection against debugging
    setInterval(() => {
      if (window.outerHeight - window.innerHeight > 200) {
        document.body.innerHTML = '';
        alert('Dev tools detected');
      }
    }, 1000);
  `;
  
  // Create encrypted response
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync('mobywatel-secret-base' + (fp || ''), 'anti-debug-salt', 32);
  const cipher = crypto.createCipher('aes-256-cbc', key);
  
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ script }), 'utf8'), cipher.final()]);
  const hash = crypto.createHash('sha256').update(script).digest('hex');
  
  res.json({
    iv: iv.toString('base64'),
    data: encrypted.toString('base64'),
    hash: hash
  });
});

app.get('/api/oauth', async (req, res) => {
  if (!supabase) {
    return res.status(503).send('Database not configured - please set up Supabase credentials');
  }

  const code = req.query.code;
  if (!code) return res.status(400).send('Brak kodu Discord');

  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET || !process.env.DISCORD_GUILD_ID || !process.env.DISCORD_BOT_TOKEN) {
    return res.status(503).send('Discord configuration incomplete - please set up Discord credentials');
  }

  try {
    // Get access token from Discord
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: `https://${req.get('host')}/login.html`
      })      
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.status(401).send('Błąd tokenu Discord');

    // Get user data
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });

    const userData = await userRes.json();
    const { id, username, avatar } = userData;
    if (!id) return res.status(500).send('Błąd danych użytkownika Discord');

    // Get user roles from server
    const memberRes = await fetch(`https://discord.com/api/guilds/${process.env.DISCORD_GUILD_ID}/members/${id}`, {
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` }
    });

    if (!memberRes.ok) {
      return res.status(403).send('Nie jesteś członkiem serwera Discord');
    }

    const memberData = await memberRes.json();
    const roles = memberData.roles || [];

    // Save to Supabase
    const { error } = await supabase
      .from('users')
      .upsert({
        discord_id: id,
        username,
        avatar,
        roles,
        last_login: new Date()
      }, { onConflict: 'discord_id' });

    if (error) {
      console.error(error);
      return res.status(500).send('Błąd Supabase');
    }

    // Redirect to main page
    return res.redirect(`/main.html?discord_id=${id}`);
  } catch (err) {
    console.error('Błąd ogólny:', err);
    return res.status(500).send('Błąd logowania');
  }
});

app.get('/api/check-user', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const discord_id = req.query.discord_id;

  if (!discord_id) return res.status(400).json({ error: 'Brak discord_id' });

  const { data, error } = await supabase
    .from('users')
    .select('roles')
    .eq('discord_id', discord_id)
    .single();

  if (error || !data) {
    return res.status(403).json({ error: 'Nie znaleziono użytkownika' });
  }

  // Check if user has client role (you can configure this)
  const CLIENT_ROLE_ID = '1414625873029758977'; // Updated role ID
  const hasClientRole = data.roles?.includes(CLIENT_ROLE_ID);

  if (!hasClientRole) {
    return res.status(403).json({ error: 'Brak roli klienta – dostęp zabroniony' });
  }

  return res.status(200).json({ roles: data.roles });
});

// Serve generated folders BEFORE catch-all HTML route with proper UTF-8 encoding
app.use('/generated', express.static(path.join(__dirname, 'generated'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
    }
  }
}));

// Serve HTML files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/*.html', (req, res) => {
  const filename = req.path.slice(1); // Remove leading slash
  // Make sure this is a main site HTML file (not from generated folders)
  if (!filename.includes('/')) {
    const filePath = path.join(__dirname, filename);
    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.sendFile(filePath);
    } else {
      res.status(404).send('File not found');
    }
  } else {
    res.status(404).send('File not found');
  }
});

// Generate folder endpoint
app.post('/api/generate', async (req, res) => {
  try {
    console.log('📝 Generate request received');
    console.log('Request body:', req.body);
    
    const data = req.body;
    
    // Validate required fields
    if (!data.imie || !data.nazwisko || !data.pesel || !data.birthdate || !data.link_zdjecia) {
      console.error('❌ Missing required fields');
      return res.status(400).json({ error: 'Missing required fields: imie, nazwisko, pesel, birthdate, link_zdjecia' });
    }
    
    const folderId = crypto.randomBytes(8).toString('hex');
    const folderPath = path.join(__dirname, 'generated', folderId);
    
    console.log(`📂 Creating folder: ${folderPath}`);
    
    // Create folder structure
    fs.mkdirSync(folderPath, { recursive: true });
    fs.mkdirSync(path.join(folderPath, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(folderPath, 'assets', 'images'), { recursive: true });
    fs.mkdirSync(path.join(folderPath, 'svg'), { recursive: true });
    
    console.log('📋 Copying assets and svg directories...');
    // Copy assets and svg directories
    await copyDirectory(path.join(__dirname, 'assets'), path.join(folderPath, 'assets'));
    await copyDirectory(path.join(__dirname, 'svg'), path.join(folderPath, 'svg'));
    
    console.log('📄 Generating HTML files...');
    // Generate HTML files with data substitution
    await generateIDPage(folderPath, data);
    await generateHomePage(folderPath, data);
    await generateCardPage(folderPath, data);
    await generateDocumentsPage(folderPath, data);
    await generateServicesPage(folderPath, data);
    await generateQRPage(folderPath, data);
    await generateMorePage(folderPath, data);
    
    console.log(`✅ Generation complete! Folder ID: ${folderId}`);
    res.json({ success: true, folderId: folderId });
  } catch (error) {
    console.error('❌ Generation error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to generate folder',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});


// Helper functions
async function copyDirectory(src, dest) {
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  
  await fs.promises.mkdir(dest, { recursive: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

async function generateIDPage(folderPath, data) {
  const template = `<!DOCTYPE html>
<html lang="pl">
<head>
  <title>mObywatel</title>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="assets/id.css">
  <link rel="stylesheet" href="assets/main.css">
  <link rel="icon" type="image/x-icon" href="assets/images/2137.jpg">
  <meta name="viewport" content="width=device-width, initial-scale=0.8, user-scalable=no">
  <script src="assets/card.js"></script>
</head>
<body>
  <div class="background"></div>
  <div class="top_grid">
    <img class="logo" src="assets/images/2137.jpg">
    <p class="logo_text">mObywatel</p>
  </div>
  <div class="top_text">
    <p class="welcome"></p>
    <p class="login_text">Zaloguj się do aplikacji.</p>
  </div>
  <div class="password_box">
    <div class="password_grid">
      <p class="password_text">Hasło</p>
      <div class="input_holder">
        <input class="password_input" id="password">
        <div class="eye"></div>
      </div>
      <p class="forgot_password">Nie pamiętasz hasła?</p>
    </div>
  </div>
  <div class="bottom">
    <p class="login" onclick="checkPassword()">Zaloguj się</p>
    <img class="logo_other" style="height: 20px;" src="assets/images/mc.svg">
    <p class="version">wersja 4.52.0 (13)</p>
  </div>
  <script>
    function checkPassword() {
      window.location.href = 'home.html';
    }
  </script>
</body>
</html>`;

  await fs.promises.writeFile(path.join(folderPath, 'index.html'), template, 'utf8');
}

async function generateHomePage(folderPath, data) {
  const template = `<!DOCTYPE html>
<html lang="pl">
<head>
  <title>mObywatel</title>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="assets/home.css">
  <link rel="stylesheet" href="assets/main.css">
  <link rel="icon" type="image/x-icon" href="assets/images/cropped.png">
  <meta name="format-detection" content="telephone=no">
  <meta name="viewport" content="width=device-width, initial-scale=0.8, user-scalable=no">
  <meta name="mobile-web-app-capable" content="yes">
</head>
<body oncontextmenu="return false;">

<div class="bottom_bar">
  <div class="bottom_bar_grid">
    <div class="bottom_element_grid" send="home">
      <div class="bottom_element_image home_open home"></div>
      <p class="bottom_element_text open">Pulpit</p>
    </div>
    <div class="bottom_element_grid" send="documents">
      <div class="bottom_element_image documents"></div>
      <p class="bottom_element_text">Dokumenty</p>
    </div>
    <div class="bottom_element_grid" send="services">
      <div class="bottom_element_image services"></div>
      <p class="bottom_element_text">Usługi</p>
    </div>
    <div class="bottom_element_grid" send="qr">
      <div class="bottom_element_image qr"></div>
      <p class="bottom_element_text">Kod QR</p>
    </div>
    <div class="bottom_element_grid" send="more">
      <div class="bottom_element_image more"></div>
      <p class="bottom_element_text">Więcej</p>
    </div>
  </div>
</div>

<div class="container">
  <div class="top_grid">
    <img src="assets/images/coi_common_ui_ic_mobywatel_logo.svg" class="top_image">
  </div>

  <div class="card_grid">
    <p class="title">Dokumenty</p>
    <button class="main_button">Dodaj</button>
    <button class="main_button all_documents">Wszystkie</button>
  </div>

  <div class="card" onclick="window.location.href='card.html'">
    <img class="background" src="assets/images/coi_common_ui_teacher_card_background.webp">
    <img class="human" src="assets/images/coi_common_ui_ic_document_id.svg">
    <div class="id_bottom">
      <p class="name">mDowód</p>
      <img class="arrow" src="assets/images/ic_arrow_forward_Dgray.svg">
    </div>
  </div>

  <div class="card_below_grid">
    <p class="title">Usługi</p>
    <button class="main_button all_services">Wszystkie</button>
  </div>

  <div class="services_grid">
    <div class="service_box">
      <img class="service_box_icon" src="assets/images/da035_bezpiecznie_w_sieci.svg">
      <p class="service_box_name">Bezpiecznie w sieci</p>
    </div>
    <div class="service_box">
      <img class="service_box_icon" src="assets/images/ee4CMJf.png">
      <p class="service_box_name">Historia pojazdu</p>
    </div>
    <div class="service_box">
      <img class="service_box_icon" src="assets/images/da008_zastrzez_pesel.png">
      <p class="service_box_name">Zastrzeż PESEL</p>
    </div>
    <div class="service_box">
      <img class="service_box_icon" src="assets/images/7EIfFr4.png">
      <p class="service_box_name">Firma</p>
    </div>
    <div class="service_box">
      <img class="service_box_icon" src="assets/images/da001_punkty_karne.svg">
      <p class="service_box_name">Punkty karne</p>
    </div>
    <div class="service_box">
      <img class="service_box_icon" src="assets/images/da025_ticket.svg">
      <p class="service_box_name">Mandaty</p>
    </div>
  </div>
</div>

<script src="assets/bar.js"></script>
<script src="assets/manifest.js"></script>
</body>
</html>`;

  await fs.promises.writeFile(path.join(folderPath, 'home.html'), template, 'utf8');
}

async function generateCardPage(folderPath, data) {
  // Set up fallback values for all fields
  const today = new Date();
  const day = today.getDate().toString().padStart(2, '0');
  const month = (today.getMonth() + 1).toString().padStart(2, '0');
  const year = today.getFullYear();
  
  const seria_i_numer = data.seria_i_numer || `${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${String.fromCharCode(65 + Math.floor(Math.random() * 26))} ${Math.floor(100000 + Math.random() * 900000)}`;
  const termin_waznosci = data.termin_waznosci || new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toLocaleDateString('pl-PL');
  const data_wydania_value = data.data_wydania || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toLocaleDateString('pl-PL');
  const plec = data.plec || 'M';
  const nazwisko_rodowe_ojca = data.nazwisko_rodowe_ojca || data.nazwisko;
  const nazwisko_rodowe_matki = data.nazwisko_rodowe_matki || 'Kowalska';
  const data_zameldowania = data.data_zameldowania || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toLocaleDateString('pl-PL');
  const ostatnia_aktualizacja = `${day}.${month}.${year}`;

  const template = `<!DOCTYPE html>
<html lang="pl">
<head>
    <title>mObywatel</title>
    <meta charset="UTF-8">
    <link rel="stylesheet" href="assets/card.css?v=1.2">
    <link rel="stylesheet" href="assets/main.css">
    <link rel="icon" type="image/x-icon" href="assets/images/2137.jpg">
    <link rel="apple-touch-icon" href="assets/images/2137.jpg">
    <link rel="shortcut icon" href="assets/images/2137.jpg">
    <meta name="format-detection" content="telephone=no">
    <meta name="viewport" content="width=device-width, initial-scale=0.8, user-scalable=no">
    <meta name="mobile-web-app-capable" content="yes">
</head>
<body>
    <div class="top_grid_fixed">
        <div class="action_grid_fixed">
            <p onclick="window.location.href='home.html'" class="back_text_fixed">Wróć</p>
        </div>
        <p class="title_text_fixed">mDowód</p>
    </div>
    <div class="bottom_bar">
        <div class="bottom_bar_grid">
            <div class="bottom_element_grid">
                <div class="bottom_element_image home"></div>
                <p class="bottom_element_text">Pulpit</p>
            </div>
            <div class="bottom_element_grid">
                <div class="bottom_element_image documents_open"></div>
                <p class="bottom_element_text open">Dokumenty</p>
            </div>
            <div class="bottom_element_grid">
                <div class="bottom_element_image services"></div>
                <p class="bottom_element_text">Usługi</p>
            </div>
            <div class="bottom_element_grid">
                <div class="bottom_element_image qr"></div>
                <p class="bottom_element_text">Kod QR</p>
            </div>
            <div class="bottom_element_grid">
                <div class="bottom_element_image more"></div>
                <p class="bottom_element_text">Więcej</p>
            </div>
        </div>
    </div>
    <div class="container">
        <p class="time_text czas">Czas: 16:08</p>
        <div class="id_image_data">
            <img draggable="false" class="id_image" src="assets/images/mid_background_main.webp">
            <div class="id_own_image" style="background-image: url('${data.link_zdjecia}');"></div>
            <img draggable="false" src="assets/images/polish_flag.gif" class="flag_video">
            <img draggable="false" src="assets/images/godlo.gif" class="eagle_video">
            <p class="eagle_text">Rzeczpospolita<br>Polska</p>
            <div class="id_data_grid">
                <div class="data_holder">
                    <p class="data_title firstname">${data.imie}</p>
                    <p class="data_value">Imię (imiona)</p>
                </div>
                <div class="data_holder">
                    <p class="data_title surname">${data.nazwisko}</p>
                    <p class="data_value">Nazwisko</p>
                </div>
                <div class="data_holder">
                    <p class="data_title">POLSKIE</p>
                    <p class="data_value">Obywatelstwo</p>
                </div>
                <div class="data_holder">
                    <p class="data_title">${data.birthdate}</p>
                    <p class="data_value">Data urodzenia</p>
                </div>
                <div class="data_holder">
                    <p class="data_title">${data.pesel}</p>
                    <p class="data_value">Numer PESEL</p>
                </div>
            </div>
        </div>
        <div class="id_bottom">
            <div class="bottom_grid">
                <img class="bottom_image" src="assets/images/check_valid.webp">
                <p class="bottom_text" style="color: #317C26; font-weight: 600; font-size: 18px; margin-left: 20px;">Dokument ważny</p>
            </div>
        </div>
        <div class="under_container">
            <div class="under_grid">
                <div class="under_icon">
                    <div class="under_image_circle">
                        <img class="under_image" src="assets/images/checkbo.png">
                    </div>
                    <p class="under_text">Potwierdź swoje dane</p>
                </div>
                <div class="under_icon">
                    <div class="under_image_circle">
                        <img class="under_image" src="assets/images/card.png">
                    </div>
                    <p class="under_text">Dane dowodu osobistego</p>
                </div>
                <div class="under_icon">
                    <div class="under_image_circle">
                        <img class="under_image" src="assets/images/da008_zastrzez_pesel.svg">
                    </div>
                    <p class="under_text">Zastrzeż PESEL</p>
                </div>
                <div class="under_icon">
                    <div class="under_image_circle">
                        <img class="under_image" src="assets/images/da031_mbiznes.svg">
                    </div>
                    <p class="under_text">Pozostałe skróty</p>
                </div>
            </div>
        </div>
        <div class="confirm_info">
            <div class="confirm_box">
                <p class="box_top">Seria i numer</p>
                <p class="box_value box_highlight">${seria_i_numer}</p>
                <button class="main_button">Kopiuj</button>
            </div>
            <div class="confirm_box">
                <p class="box_top">Termin ważności</p>
                <p class="box_value">${termin_waznosci}</p>
            </div>
            <div class="confirm_box">
                <p class="box_top">Data wydania</p>
                <p class="box_value">${data_wydania_value}</p>
            </div>
            <div class="confirm_box">
                <p class="box_top">Imię ojca</p>
                <p class="box_value">${data.imie_ojca}</p>
            </div>
            <div class="confirm_box" style="border: none;">
                <p class="box_top">Imię matki</p>
                <p class="box_value">${data.imie_matki}</p>
            </div>
        </div>
        <div class="other_grid">
            <div class="bottom_holder info_holder">
                <div class="bottom_grid">
                    <p class="bottom_text" style="color: #1f2125; margin-bottom: 120px;">Twoje dodatkowe dane</p>
                </div>
                <div class="additional_holder">
                    <div class="additional_grid">
                        <p class="additional_title">Nazwisko rodowe</p>
                        <p class="additional_subtitle">${data.nazwisko}</p>
                    </div>
                    <div class="additional_grid">
                        <p class="additional_title">Płeć</p>
                        <p class="additional_subtitle">${plec}</p>
                    </div>
                    <div class="additional_grid">
                        <p class="additional_title">Nazwisko rodowe ojca</p>
                        <p class="additional_subtitle">${nazwisko_rodowe_ojca}</p>
                    </div>
                    <div class="additional_grid">
                        <p class="additional_title">Nazwisko rodowe matki</p>
                        <p class="additional_subtitle">${nazwisko_rodowe_matki}</p>
                    </div>
                    <div class="additional_grid">
                        <p class="additional_title">Miejsce urodzenia</p>
                        <p class="additional_subtitle">${data.miejsce_urodzenia}</p>
                    </div>
                    <div class="additional_grid">
                        <p class="additional_title">Kraj urodzenia</p>
                        <p class="additional_subtitle">Polska</p>
                    </div>
                    <div class="additional_grid">
                        <p class="additional_title">Adres zameldowania na pobyt stały</p>
                        <p class="additional_subtitle">${data.adres}, ${data.kod_pocztowy_miasto}</p>
                    </div>
                    <div class="additional_grid" style="border-bottom: none;">
                        <p class="additional_title">Data zameldowania na pobyt stały</p>
                        <p class="additional_subtitle">${data_zameldowania}</p>
                    </div>
                </div>
            </div>
        </div>        
        <div class="bottom_holder" style="height: 90px; margin-bottom: 120px;">
            <div class="bottom_update">
                <div class="bottom_update_grid">
                    <p class="bottom_update_text" style="margin-left: 0px;">Ostatnia aktualizacja</p>
                    <p class="bottom_update_value" style="margin-left: 0px;">${ostatnia_aktualizacja}</p>
                </div>
                <button class="main_button update">Aktualizuj</button>
            </div>
        </div>
    </div>
    <script>
        const czas = document.querySelector('.czas');

        setInterval(() => {
            const now = new Date();
            const hour = now.getHours() < 10 ? \`0\${now.getHours()}\` : now.getHours();
            const minute = now.getMinutes() < 10 ? \`0\${now.getMinutes()}\` : now.getMinutes();
            const second = now.getSeconds() < 10 ? \`0\${now.getSeconds()}\` : now.getSeconds();
            const month = (now.getMonth()+1) < 10 ? \`0\${now.getMonth()+1}\` : now.getMonth()+1;
            const timeString = \`Czas: \${hour}:\${minute}:\${second} \${now.getDate()}.\${month}.\${now.getFullYear()}\`;
            document.querySelector('.czas').innerHTML = timeString;
            czas.innerHTML = timeString;
        }, 1000);
    </script>
</body>
</html>`;

  await fs.promises.writeFile(path.join(folderPath, 'card.html'), template, 'utf8');
}

async function generateDocumentsPage(folderPath, data) {
  const template = `<!DOCTYPE html>
<html lang="pl">
<head>
    <!-- auth-check removed for standalone documents --></script>
    <script src="assets/main.js"></script>
    <title>mObywatel</title>
    <meta charset="UTF-8">
    <link rel="stylesheet" href="assets/documents.css">
    <link rel="stylesheet" href="assets/main.css">
    <link rel="icon" type="image/png" href="assets/logo.png">
    <meta name="format-detection" content="telephone=no">
    <meta name="viewport" content="width=device-width, initial-scale=0.8, user-scalable=no">
    <meta name="mobile-web-app-capable" content="yes">
</head>
<body oncontextmenu="return false;">
    <div class="bottom_bar">
        <div class="bottom_bar_grid">
            <div class="bottom_element_grid" send="home">
                <div class="bottom_element_image home"></div>
                <p class="bottom_element_text">Pulpit</p>
            </div>
            <div class="bottom_element_grid" send="documents">
                <div class="bottom_element_image documents documents_open"></div>
                <p class="bottom_element_text open">Dokumenty</p>
            </div>
            <div class="bottom_element_grid" send="services">
                <div class="bottom_element_image services"></div>
                <p class="bottom_element_text">Usługi</p>
            </div>
            <div class="bottom_element_grid" send="qr">
                <div class="bottom_element_image qr"></div>
                <p class="bottom_element_text">Kod QR</p>
            </div>
            <div class="bottom_element_grid" send="more">
                <div class="bottom_element_image more"></div>
                <p class="bottom_element_text">Więcej</p>
            </div>
        </div>
    </div>

    <div class="container">
        <p class="action_add action">Dodaj</p>
        <p class="action_edit action">Edytuj</p>
        <p class="main_title">Dokumenty</p>
        <div class="search_grid">
            <img class="search_icon" src="svg/ab002_search_grey.svg">
            <input class="search" placeholder="Szukaj">
        </div>
        <p class="title">Na pulpicie</p>
        <div class="card" onclick="sendTo('card')">
            <img class="human" src="assets/images/coi_common_ui_ic_document_id.svg">
            <p class="title">mDowód</p>
            <img class="arrow" src="assets/images/ic_arrow_forward_gray.svg">
        </div>
        <p class="title">Pozostałe</p>
    </div>
    <script src="assets/bar.js"></script>
</body>
</html>`;

  await fs.promises.writeFile(path.join(folderPath, 'documents.html'), template, 'utf8');
}

async function generateServicesPage(folderPath, data) {
  const template = `<!DOCTYPE html>
<html lang="pl">
<head>
  <!-- auth-check removed for standalone documents --></script>
  <script src="assets/main.js"></script>
  <title>mObywatel</title>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="assets/services.css">
  <link rel="stylesheet" href="assets/main.css">
  <link rel="icon" type="image/png" href="assets/logo.png">
  <meta name="viewport" content="width=device-width, initial-scale=0.8, user-scalable=no">
</head>
<body oncontextmenu="return false;">

  <div class="bottom_bar">
    <div class="bottom_bar_grid">
      <div class="bottom_element_grid" send="home">
        <div class="bottom_element_image home"></div>
        <p class="bottom_element_text">Pulpit</p>
      </div>
      <div class="bottom_element_grid" send="documents">
        <div class="bottom_element_image documents"></div>
        <p class="bottom_element_text">Dokumenty</p>
      </div>
      <div class="bottom_element_grid" send="services">
        <div class="bottom_element_image services services_open"></div>
        <p class="bottom_element_text open">Usługi</p>
      </div>
      <div class="bottom_element_grid" send="qr">
        <div class="bottom_element_image qr"></div>
        <p class="bottom_element_text">Kod QR</p>
      </div>
      <div class="bottom_element_grid" send="more">
        <div class="bottom_element_image more"></div>
        <p class="bottom_element_text">Więcej</p>
      </div>
    </div>
  </div>

  <div class="container">
    <p class="action">Edytuj</p>
    <p class="main_title">Usługi</p>

    <div class="search_grid">
      <img class="search_icon" src="svg/ab002_search_grey.svg">
      <input class="search" placeholder="Szukaj">
    </div>

    <p class="title">Na pulpicie</p>
    <div class="services_list">
      <div class="service">
        <img class="service_icon" src="assets/images/ee4CMJf.png">
        <p class="service_name">Historia pojazdu</p>
        <img class="arrow" src="assets/images/ic_arrow_forward_gray.svg">
      </div>
      <div class="service">
        <img class="service_icon" src="assets/images/da008_zastrzez_pesel.png">
        <p class="service_name">Zastrzeż PESEL</p>
        <img class="arrow" src="assets/images/ic_arrow_forward_gray.svg">
      </div>
      <div class="service">
        <img class="service_icon" src="assets/images/7EIfFr4.png">
        <p class="service_name">Firma</p>
        <img class="arrow" src="assets/images/ic_arrow_forward_gray.svg">
      </div>
      <div class="service">
        <img class="service_icon" src="svg/punktykarne.svg">
        <p class="service_name">Punkty karne</p>
        <img class="arrow" src="assets/images/ic_arrow_forward_gray.svg">
      </div>
      <div class="service">
        <img class="service_icon" src="svg/mandaty.svg">
        <p class="service_name">Mandaty</p>
        <img class="arrow" src="assets/images/ic_arrow_forward_gray.svg">
      </div>
    </div>
  </div>
  <script src="assets/bar.js"></script>
</body>
</html>`;

  await fs.promises.writeFile(path.join(folderPath, 'services.html'), template, 'utf8');
}

async function generateQRPage(folderPath, data) {
  const template = `<!DOCTYPE html>
<html lang="pl">
<head>
  <!-- auth-check removed for standalone documents -->
  <meta charset="UTF-8">
  <title>mObywatel</title>
  <meta name="viewport" content="width=device-width, initial-scale=0.8, user-scalable=no">

  <link rel="stylesheet" href="assets/qr.css">
  <link rel="stylesheet" href="assets/main.css">

  <!-- Libraries -->
  <script src="https://unpkg.com/html5-qrcode"></script>
  <script src="https://cdn.jsdelivr.net/npm/qrcodejs/qrcode.min.js"></script>

  <!-- Scripts -->
  <script defer src="assets/main.js"></script>
</head>
<body oncontextmenu="return false;">

  <div class="bottom_bar">
    <div class="bottom_bar_grid">
      <div class="bottom_element_grid" send="home">
        <div class="bottom_element_image home"></div>
        <p class="bottom_element_text">Pulpit</p>
      </div>
      <div class="bottom_element_grid" send="documents">
        <div class="bottom_element_image documents"></div>
        <p class="bottom_element_text">Dokumenty</p>
      </div>
      <div class="bottom_element_grid" send="services">
        <div class="bottom_element_image services"></div>
        <p class="bottom_element_text">Usługi</p>
      </div>
      <div class="bottom_element_grid" send="qr">
        <div class="bottom_element_image qr qr_open"></div>
        <p class="bottom_element_text open">Kod QR</p>
      </div>
      <div class="bottom_element_grid" send="more">
        <div class="bottom_element_image more"></div>
        <p class="bottom_element_text">Więcej</p>
      </div>
    </div>
  </div>

  <div class="container">
    <p class="main_title">Kod QR</p>
    <p class="description">Wybierz, co chcesz zrobić</p>
    <div class="action_grid">
      <div class="action scan">
        <img class="action_image" src="assets/images/checkbo.png">
        <div class="action_text">
            <p class="action_title">Zeskanuj kod QR</p>
            <p class="action_subtitle">Zaloguj się lub potwierdź swoje dane.</p>
        </div>
        <img class="arrow" src="svg/arrow.svg">
      </div>
      
      <div class="action show">
        <img class="action_image" src="svg/ai003_check_document.svg">
        <div class="action_text">
            <p class="action_title">Pokaż kod QR</p>
            <p class="action_subtitle">Sprawdź dokument innej osoby.</p>
        </div>
        <img class="arrow" src="svg/arrow.svg">
      </div>
    </div>
  </div>

  <script src="assets/bar.js"></script>
  <script src="assets/qr.js"></script>

  <script>
    // Set user data from generated document
    localStorage.setItem('pesel', '${data.pesel}');
    localStorage.setItem('firstName', '${data.imie}');
    localStorage.setItem('lastName', '${data.nazwisko}');
    localStorage.setItem('birthDate', '${data.birthdate}');
    localStorage.setItem('issueDate', '${data.data_wydania || new Date().toLocaleDateString('pl-PL')}');
    localStorage.setItem('photo', '${data.link_zdjecia}');
  </script>
</body>
</html>`;

  await fs.promises.writeFile(path.join(folderPath, 'qr.html'), template, 'utf8');
}

async function generateMorePage(folderPath, data) {
  const template = `<!DOCTYPE html>
<html lang="pl">
<head>
    <!-- auth-check removed for standalone documents -->
    <script src="assets/main.js"></script>
    <title>mObywatel</title>
    <meta charset="UTF-8">
    <link rel="stylesheet" href="assets/more.css">
    <link rel="stylesheet" href="assets/main.css">
    <link rel="icon" type="image/x-icon" href="assets/images/cropped.png">
    <link rel="apple-touch-icon" href="assets/images/cropped.png">
    <link rel="shortcut icon" href="assets/images/cropped.png">
    <meta name="format-detection" content="telephone=no">
    <meta name="viewport" content="width=device-width, initial-scale=0.8, user-scalable=no">
    <meta name="mobile-web-app-capable" content="yes">
</head>
<body oncontextmenu="return false;">

    <div class="bottom_bar">
        <div class="bottom_bar_grid">
            <div class="bottom_element_grid" send="home">
                <div class="bottom_element_image home"></div>
                <p class="bottom_element_text">Pulpit</p>
            </div>
            <div class="bottom_element_grid" send="documents">
                <div class="bottom_element_image documents"></div>
                <p class="bottom_element_text">Dokumenty</p>
            </div>
            <div class="bottom_element_grid" send="services">
                <div class="bottom_element_image services"></div>
                <p class="bottom_element_text">Usługi</p>
            </div>
            <div class="bottom_element_grid" send="qr">
                <div class="bottom_element_image qr"></div>
                <p class="bottom_element_text">Kod QR</p>
            </div>
            <div class="bottom_element_grid" send="more">
                <div class="bottom_element_image more more_open"></div>
                <p class="bottom_element_text open">Więcej</p>
            </div>
        </div>
    </div>

    <div class="container">
        <p class="main_title">Więcej</p>
        <p class="title">Ustawienia</p>
        <div class="services_list">
            <div class="service">
                <img class="service_icon" src="svg/aa008_change_password.svg">
                <p class="service_name">Zmień hasło</p>
                <img class="arrow" src="assets/images/ic_arrow_forward_gray.svg">
            </div>
            <div class="service">
                <img class="service_icon" src="svg/aa009_fingerprint.svg">
                <p class="service_name">Logowanie biometryczne</p>
                <img class="arrow" src="assets/images/ic_arrow_forward_gray.svg">
            </div>
            <div class="service">
                <img class="service_icon" src="svg/ab013_notifications.svg">
                <p class="service_name">Powiadomienia</p>
                <img class="arrow" src="assets/images/ic_arrow_forward_gray.svg">
            </div>
            <div class="service">
                <img class="service_icon" src="svg/ag005_globe.svg">
                <p class="service_name">Język aplikacji</p>
                <img class="arrow" src="assets/images/ic_arrow_forward_gray.svg">
            </div>
            <div class="service" style="border: none;">
                <img class="service_icon" src="svg/ae001_published_certificate.svg">
                <p class="service_name">Wydane certyfikaty</p>
                <img class="arrow" src="assets/images/ic_arrow_forward_gray.svg">
            </div>
        </div>
        <p class="title">Pozostałe</p>
        <div class="services_list" style="margin-bottom: 150px;">
            <div class="service">
                <img class="service_icon" src="svg/aa016_history.svg">
                <p class="service_name">Historia aktywności</p>
                <img class="arrow" src="assets/images/ic_arrow_forward_gray.svg">
            </div>
            <div class="service">
                <img class="service_icon" src="svg/ad005_framed_person.svg">
                <p class="service_name">Informacje prawne</p>
                <img class="arrow" src="assets/images/ic_arrow_forward_gray.svg">
            </div>
            <div class="service" style="border: none;">
                <img class="service_icon" src="assets/images/coi_common_ui_ic_help.svg">
                <p class="service_name">Pomoc techniczna</p>
                <img class="arrow" src="assets/images/ic_arrow_forward_gray.svg">
            </div>
        </div>
    </div>

    <script src="assets/bar.js"></script>
    <script src="assets/manifest.js"></script>
</body>
<script>
    fetch('/api/antidebug.js')
      .then(res => res.text())
      .then(code => {
        const s = document.createElement('script');
        s.textContent = code;
        document.body.appendChild(s);
      });
  </script>
</html>`;

  await fs.promises.writeFile(path.join(folderPath, 'more.html'), template, 'utf8');
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ mObywatel server running on http://0.0.0.0:${PORT}`);
  console.log(`🔗 Access your app at the preview URL`);
});
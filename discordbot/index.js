// index.js
require('dotenv').config();

const { Client, GatewayIntentBits, SlashCommandBuilder, PermissionFlagsBits, REST, Routes, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch').default;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_API_KEY);

// Komendy
const commands = [
  new SlashCommandBuilder()
    .setName('register')
    .setDescription('Rejestruj się za pomocą klucza i roli')
    .addStringOption(option =>
      option.setName('key').setDescription('Podaj swój klucz').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('createkey')
    .setDescription('Generuje nowy klucz i zapisuje do bazy (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('generate')
    .setDescription('Generate mObywatel document - opens form')
].map(command => command.toJSON());

// Rejestracja komend
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
rest.put(Routes.applicationGuildCommands(process.env.DISCORD_APPLICATION_ID, process.env.DISCORD_GUILD_ID), { body: commands })
  .then(() => console.log('✅ Komendy zarejestrowane!'))
  .catch(console.error);

// Obsługa komend i modali
client.on('interactionCreate', async interaction => {
  // Handle slash commands
  if (interaction.isChatInputCommand()) {
    
    // Komenda /register
    if (interaction.commandName === 'register') {
      const key = interaction.options.getString('key');
      const userId = interaction.user.id;

      const { data: keyData, error: keyError } = await supabase
        .from('keys')
        .select('*')
        .eq('key', key)
        .single();

      if (keyError || !keyData || keyData.used) {
        await interaction.reply({ content: '❌ Nieprawidłowy lub już użyty klucz!', ephemeral: true });
        return;
      }

      const token = process.env.DISCORD_BOT_TOKEN;

      // Pobieranie danych użytkownika
      const userResponse = await fetch(`https://discord.com/api/v10/users/@me`, {
        headers: { Authorization: `Bot ${token}` }
      });
      const userData = await userResponse.json();
      console.log('🧑 Dane użytkownika:', userData);

      // Pobieranie danych członka z serwera
      const memberResponse = await fetch(`https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${userId}`, {
        headers: { Authorization: `Bot ${token}` }
      });
      const memberData = await memberResponse.json();
      console.log('📄 Dane członka serwera:', memberData);

      if (!memberData.roles || !memberData.roles.includes('1414625873029758977')) {
        await interaction.reply({ content: '❌ Użytkownik nie ma wymaganej roli "klient".', ephemeral: true });
        return;
      }

      const { error: insertError } = await supabase
        .from('passwords')
        .insert([{
          password: crypto.randomBytes(8).toString('hex'),
          hwid: userData.id,
          loggedIn: false,
          userID: userId
        }]);

      if (insertError) {
        await interaction.reply({ content: '❌ Wystąpił błąd przy dodawaniu do bazy!', ephemeral: true });
        return;
      }

      await supabase
        .from('keys')
        .update({ used: true })
        .eq('key', key);

      const jwtToken = jwt.sign({ userId, username: interaction.user.username }, process.env.JWT_SECRET, { expiresIn: '1h' });

      await interaction.reply({
        content: `✅ Rejestracja zakończona pomyślnie! Oto Twój token: \`${jwtToken}\`. Możesz teraz użyć go do zalogowania się na stronie.`,
        ephemeral: true
      });
    }

    // Komenda /createkey
    if (interaction.commandName === 'createkey') {
      const newKey = crypto.randomBytes(8).toString('hex').toUpperCase();

      const { error: keyInsertError } = await supabase
        .from('keys')
        .insert([{ key: newKey, used: false }]);

      if (keyInsertError) {
        await interaction.reply({ content: '❌ Wystąpił błąd przy tworzeniu klucza!', ephemeral: true });
        return;
      }

      await interaction.reply({ content: `✅ Nowy klucz: \`${newKey}\``, ephemeral: true });
    }

    // Komenda /generate
    if (interaction.commandName === 'generate') {
      const userId = interaction.user.id;
      const token = process.env.DISCORD_BOT_TOKEN;

      // Check if user has required role
      const memberResponse = await fetch(`https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${userId}`, {
        headers: { Authorization: `Bot ${token}` }
      });
      const memberData = await memberResponse.json();

      if (!memberData.roles || !memberData.roles.includes('1414625873029758977')) {
        await interaction.reply({ content: '❌ Nie masz wymaganej roli do generowania dokumentów.', ephemeral: true });
        return;
      }

      // Create modal for data collection
      const modal = new ModalBuilder()
        .setCustomId('generate_modal')
        .setTitle('Generuj mObywatel - Dane osobowe');

      const imieInput = new TextInputBuilder()
        .setCustomId('imie')
        .setLabel('Imię')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const nazwiskoInput = new TextInputBuilder()
        .setCustomId('nazwisko')
        .setLabel('Nazwisko')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const peselInput = new TextInputBuilder()
        .setCustomId('pesel')
        .setLabel('PESEL')
        .setStyle(TextInputStyle.Short)
        .setMinLength(11)
        .setMaxLength(11)
        .setRequired(true);

      const birthdateInput = new TextInputBuilder()
        .setCustomId('birthdate')
        .setLabel('Data urodzenia (DD.MM.YYYY)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('np. 15.03.1990')
        .setRequired(true);

      const linkZdjeciaInput = new TextInputBuilder()
        .setCustomId('link_zdjecia')
        .setLabel('Link do zdjęcia')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('https://example.com/photo.jpg')
        .setRequired(true);

      const firstActionRow = new ActionRowBuilder().addComponents(imieInput);
      const secondActionRow = new ActionRowBuilder().addComponents(nazwiskoInput);
      const thirdActionRow = new ActionRowBuilder().addComponents(peselInput);
      const fourthActionRow = new ActionRowBuilder().addComponents(birthdateInput);
      const fifthActionRow = new ActionRowBuilder().addComponents(linkZdjeciaInput);

      modal.addComponents(firstActionRow, secondActionRow, thirdActionRow, fourthActionRow, fifthActionRow);

      await interaction.showModal(modal);
    }
  }

  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'generate_modal') {
      const imie = interaction.fields.getTextInputValue('imie');
      const nazwisko = interaction.fields.getTextInputValue('nazwisko');
      const pesel = interaction.fields.getTextInputValue('pesel');
      const birthdate = interaction.fields.getTextInputValue('birthdate');
      const link_zdjecia = interaction.fields.getTextInputValue('link_zdjecia');

      // Generate additional data
      const folderId = crypto.randomBytes(8).toString('hex');
      const currentDate = new Date().toLocaleDateString('pl-PL');
      
      const generatedData = {
        imie,
        nazwisko,
        pesel,
        birthdate,
        link_zdjecia,
        // Generate sample additional data
        seria_i_numer: `${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${String.fromCharCode(65 + Math.floor(Math.random() * 26))} ${Math.floor(100000 + Math.random() * 900000)}`,
        termin_waznosci: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toLocaleDateString('pl-PL'),
        data_wydania: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toLocaleDateString('pl-PL'),
        imie_ojca: 'Jan',
        imie_matki: 'Anna',
        plec: 'M',
        nazwisko_rodowe_ojca: nazwisko,
        nazwisko_rodowe_matki: 'Kowalska',
        miejsce_urodzenia: 'Warszawa',
        adres: 'ul. Przykładowa 123',
        kod_pocztowy_miasto: '00-001 Warszawa',
        data_zameldowania: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toLocaleDateString('pl-PL'),
        ostatnia_aktualizacja: currentDate,
        discord_id: interaction.user.id
      };

      try {
        // Call the server API to generate the site  
        const serverUrl = process.env.CUSTOM_DOMAIN || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://localhost:5000');
        const response = await fetch(`${serverUrl}/api/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(generatedData)
        });

        if (response.ok) {
          const result = await response.json();
          const generatedUrl = `${serverUrl}/generated/${result.folderId}/index.html`;
          
          await interaction.reply({
            content: `✅ Dokument wygenerowany pomyślnie!\n🔗 Twój mObywatel: ${generatedUrl}`,
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: '❌ Wystąpił błąd podczas generowania dokumentu.',
            ephemeral: true
          });
        }
      } catch (error) {
        console.error('Error generating document:', error);
        await interaction.reply({
          content: '❌ Wystąpił błąd podczas generowania dokumentu.',
          ephemeral: true
        });
      }
    }
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
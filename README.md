# Project Novex RP – nettside og spillerpanel

Nettside for FiveM-serveren Project Novex med:

- forside med bakgrunnsvideo fra YouTube, trailer på repeat, skjermbilder fra serveren og «Lag karakteren din» med eget Novex ID-kort
- innlogging med Discord
- whitelist-søknad, jobbsøknader og søknader for bedrift, gjeng og staff
- tickets med svartråder mellom spiller og staff
- staff-panel for å godkjenne og avslå søknader og svare på tickets
- FiveM-ressurs som stenger ute spillere uten godkjent whitelist
- spillerteller som henter tall fra FiveM-serveren
- ticket-bot i Discord: `/ticket`, fast knapp, privat kanal per ticket og svar som synkes med nettsiden
- bot som gir whitelist-rollen i Discord, og varsler i en Discord-kanal

Prosjektet har ingen npm-pakker. Det trenger bare **Node.js 22.13 eller nyere**.

---

## Legg ut på Netlify (anbefalt)

Prosjektet kan kjøres helt på Netlify uten egen server. API-et ligger i `netlify/functions/api.mjs`, og data lagres i Netlify Blobs, så du trenger ingen database.

1. På Netlify: **Add new project → Import an existing project → GitHub → Novex-RP**. Innstillingene leses fra `netlify.toml`.
2. Under **Project configuration → Environment variables**, legg inn de samme variablene som i `.env.example`. `BASE_URL` trengs ikke, Netlify fyller den inn selv.
3. I Discord Developer Portal:
   - **OAuth2 → Redirects:** `https://<din-side>.netlify.app/auth/callback`
   - **General Information → Interactions Endpoint URL:** `https://<din-side>.netlify.app/api/discord/interactions`
   - Kopier **Public Key** fra samme side til `DISCORD_PUBLIC_KEY`.
4. Deploy på nytt etter at variablene er lagt inn. Logg inn på siden som staff, gå til Staff og trykk **Registrer Discord-kommandoer**.

### Staff-team og rettigheter

Eiere står i `STAFF_DISCORD_IDS` og har alltid alle rettigheter. Andre gjøres til staff på nettsiden under **Spillerpanel → Staff-team**:

1. Søk etter personen (de må ha logget inn én gang) eller lim inn Discord-ID-en.
2. Gi en tittel og velg rettigheter, eller bruk et hurtigvalg (Support, Moderator, Admin, Head Admin).
3. Trykk **Legg til som staff**. Endringen gjelder med en gang.

| Rettighet | Gir tilgang til |
|---|---|
| Se og svare på tickets | Alle tickets på nettsiden og ticket-kanalene i Discord |
| Lukke og slette tickets | Lukke, åpne og slette ticket-kanaler |
| Behandle whitelist-søknader | Godkjenne og avslå whitelist |
| Behandle jobb-, bedrift- og gjengsøknader | Politi, ambulanse, mekaniker, bilselger, bedrift og gjeng |
| Behandle staff-søknader | Nye staff-søknader |
| Discord-oppsett | Registrere kommandoer og legge ut ticket-panelet |
| Administrere staff | Legge til og fjerne staff. Kan bare gi rettigheter de har selv, og bare eieren kan gi denne |

Ingen kan endre sine egne rettigheter eller eierne. Alle endringer vises under **Siste endringer**. Har du også en staff-rolle i Discord (`DISCORD_STAFF_ROLE_IDS`), får de med rollen rettighetene i `DISCORD_STAFF_ROLE_PERMS`.

Staff-team finnes foreløpig bare i Netlify-versjonen. `server.js` bruker fortsatt `STAFF_DISCORD_IDS` og staff-rollen.

**Ticket-boten på Netlify** svarer på knapper og skjemaer i stedet for å være tilkoblet hele tiden. Spillere og staff svarer med **Svar**-knappen i ticket-kanalen, og svaret synkes med nettsiden. Vanlige meldinger som skrives rett i kanalen, synkes ikke. Vil du ha det, kjører du `server.js` på en egen server i stedet (se under).

## Kjør på egen server (alternativ)

## 1. Lag en Discord-app

1. Gå til <https://discord.com/developers/applications> og trykk **New Application**. Kall den «Novex RP».
2. Åpne **OAuth2**. Kopier **Client ID** og **Client Secret**.
3. Under **Redirects**, legg til adressen til siden + `/auth/callback`, for eksempel:
   - `https://novexrp.no/auth/callback`
   - `http://localhost:3000/auth/callback` (for testing på egen maskin)

### Ticket-bot og whitelist-rolle

Boten kjører inne i nettsiden, så du trenger ikke starte noe ekstra.

1. Åpne **Bot** i samme app, trykk **Reset Token** og kopier tokenet til `DISCORD_BOT_TOKEN`.
2. På samme side: slå på **Message Content Intent**. Uten den kan ikke boten lese meldinger i ticket-kanalene.
3. Inviter boten til Discord-serveren (bytt inn din Client ID):
   `https://discord.com/oauth2/authorize?client_id=DIN_CLIENT_ID&scope=bot%20applications.commands&permissions=268553232`
   Det gir boten lov til å lage kanaler, styre rettigheter og skrive meldinger.
4. Lag en kategori i Discord som heter for eksempel «Tickets», og legg ID-en i `DISCORD_TICKET_CATEGORY_ID`.
5. Dra bot-rollen **over** staff- og whitelist-rollene i rollelisten. Ellers får den ikke gitt roller eller satt rettigheter.
6. Start nettsiden. Skriv `/ticket-panel` i kanalen der spillerne skal opprette tickets.

**Slik fungerer det:**

- Spillere trykker på **Opprett ticket** eller skriver `/ticket`, velger kategori og fyller ut skjemaet.
- Boten lager en privat kanal, for eksempel `#ticket-1001`, som bare spilleren og staff-rollene ser.
- Alt som skrives i kanalen, vises på nettsiden under Tickets, og svar fra nettsiden postes i kanalen.
- Tickets som opprettes på nettsiden, får også en kanal.
- **Lukk ticket** låser kanalen for spilleren og gir den navnet `lukket-1001`. Staff kan åpne den igjen eller slette kanalen.
- Spillere som ikke er med i Discord-serveren, kan bare bruke tickets på nettsiden. Staff ser saken i kanalen og svarer der.

Bilder som sendes i kanalen, lagres som lenker. Discord-lenker til vedlegg slutter etter hvert å virke, så be spillerne bruke YouTube, Medal eller Streamable til klipp.

### Finn ID-er i Discord

Slå på **Innstillinger → Avansert → Utviklermodus**. Da kan du høyreklikke og velge «Kopier ID» på serveren, roller og brukere.

---

## 2. Sett opp nettsiden

```bash
cp .env.example .env
```

Fyll inn `.env`. Det viktigste:

| Variabel | Hva |
|---|---|
| `BASE_URL` | Adressen til siden, f.eks. `https://novexrp.no` |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | Fra steg 1 |
| `STAFF_DISCORD_IDS` | Din egen Discord-ID, så du blir staff |
| `DISCORD_GUILD_ID` + `DISCORD_STAFF_ROLE_IDS` | Gir staff-tilgang til alle med staff-rollen |
| `FIVEM_API_KEY` | Lang tilfeldig nøkkel som FiveM-ressursen bruker |
| `FIVEM_SERVER_URL` | `http://IP:30120` til FiveM-serveren, for spillertelleren |
| `CONNECT_ADDRESS` | Det spillerne skriver etter `connect` |

Lag en API-nøkkel slik:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Start:

```bash
npm start
```

Siden kjører nå på `http://localhost:3000`. Databasen lagres i `data/novex.db`.

Staff-rollen leses når noen logger inn. Gir du noen staff-rollen i Discord, må de logge ut og inn igjen.

---

## 3. Legg siden ut på nett

Siden trenger en server som alltid er på, for eksempel en VPS hos Hetzner, DigitalOcean eller samme maskin som FiveM-serveren.

1. Installer Node.js 22: <https://nodejs.org>
2. Kopier mappen til serveren og fyll inn `.env`.
3. Hold den i gang med pm2:
   ```bash
   npm install -g pm2
   pm2 start server.js --name novex
   pm2 save && pm2 startup
   ```
4. Sett opp HTTPS med Caddy (enklest). Pek domenet til serverens IP og lag `/etc/caddy/Caddyfile`:
   ```
   novexrp.no {
     reverse_proxy localhost:3000
   }
   ```
   Caddy henter sertifikat selv. Sett `TRUST_PROXY=true` i `.env`.

**Backup:** ta kopi av `data/novex.db` jevnlig. Der ligger alle brukere, søknader og tickets.

---

## 4. Koble til FiveM

1. Kopier mappen `fivem/novex-whitelist` til `resources/` på FiveM-serveren.
2. Åpne `config.lua` og sett `Config.ApiUrl` og `Config.ApiKey` (samme som `FIVEM_API_KEY`).
3. Legg til i `server.cfg`:
   ```
   ensure novex-whitelist
   ```
4. Restart FiveM-serveren.

Når noen kobler til, leser ressursen Discord-ID-en deres fra FiveM og spør nettsiden om de er whitelistet. Spillere må ha Discord åpent mens de starter FiveM. Staff slipper alltid inn.

Fjern andre whitelist-ressurser du har fra før, så de ikke krangler.

---

## 5. Endre innhold

| Hva | Hvor |
|---|---|
| Spørsmål i søknadene, stillinger, ticket-kategorier | `public/forms.js` |
| Regelverket | `vRules()` i `public/app.js` |
| Bedrifter, biler og filmklipp | `BIZ`, `CARS` og `CLIPS` øverst i `public/app.js` |
| Tekster på forsiden | `public/index.html` |
| Egne skjermbilder | `public/img/` (se `LES-MEG.txt` der) |
| Yrker i «Lag karakteren din» | `ID_JOBS` i `public/app.js` |
| Egne videoklipp i «Novex på film» | `public/video/` (se `LES-MEG.txt` der) og `CLIPS` i `public/app.js` |
| YouTube-trailer | `YOUTUBE_TRAILER_ID` i `.env` |
| Bakgrunnsvideo øverst på forsiden | `HERO_YOUTUBE_ID` i `.env` (YouTube), eller tom verdi for å bruke `public/video/hero.mp4` |

Sett `open: false` på en stilling i `public/forms.js` for å stenge den.

---

## API (for egne scripts)

| Rute | Hva |
|---|---|
| `GET /api/fivem/whitelist/:discordId` | `{ whitelisted, registered, staff }`. Krever headeren `x-api-key`. |
| `GET /api/status` | Spillere online fra FiveM-serveren |

Resten av API-et under `/api/` brukes av nettsiden og krever innlogging.

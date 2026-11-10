/* Søknadsskjemaer, stillinger og ticket-kategorier.
   Brukes av både nettsiden og serveren, så endringer her gjelder begge steder. */
(function (root) {
  'use strict';

  const AGE = { id: 'alder', label: 'Hvor gammel er du?', hint: 'Serveren har 16-årsgrense.', type: 'number', req: 1 };
  const DISC = { id: 'discord', label: 'Discord-brukernavn', type: 'text', req: 1 };
  const TID = { id: 'tid', label: 'Hvor mange timer i uken kan du være aktiv?', type: 'select', options: ['Under 5', '5–10', '10–20', 'Over 20'], req: 1 };

  const FORMS = {
    whitelist: {
      title: 'Whitelist', group: 'Whitelist',
      intro: 'Svar ærlig og utfyllende. Staff leser alle søknader og svarer deg her i panelet.',
      q: [
        AGE,
        { id: 'erfaring', label: 'Hvor mye erfaring har du med roleplay?', type: 'select', options: ['Ingen', 'Under 6 måneder', '6–12 måneder', '1–3 år', 'Over 3 år'], req: 1 },
        { id: 'ban', label: 'Har du vært utestengt fra andre RP-servere? Hvis ja, forklar hvorfor.', type: 'textarea', req: 1 },
        { id: 'karakter', label: 'Fortell om karakteren du vil spille.', hint: 'Navn, alder, bakgrunn og hva karakteren vil oppnå i byen. Minst 300 tegn.', type: 'textarea', req: 1, min: 300 },
        { id: 'fail', label: 'Hva betyr FailRP? Gi et eksempel.', type: 'textarea', req: 1 },
        { id: 'rdm', label: 'Hva er forskjellen på RDM og VDM?', type: 'textarea', req: 1 },
        { id: 'scenario', label: 'Du blir ranet med våpen mot hodet, men har en kniv i lomma. Hva gjør karakteren din?', type: 'textarea', req: 1 },
        { id: 'regler', label: 'Har du lest og forstått regelverket?', type: 'select', options: ['Ja, jeg har lest hele regelverket', 'Nei'], req: 1, must: 'Ja, jeg har lest hele regelverket' }
      ]
    },
    politi: {
      title: 'Politiet', group: 'Stillinger',
      intro: 'Politiet håndhever lov og orden med reelle verktøy og konsekvenser.',
      q: [AGE, DISC, TID,
        { id: 'hvorfor', label: 'Hvorfor vil du bli politi i Novex?', type: 'textarea', req: 1 },
        { id: 'erf', label: 'Tidligere erfaring fra politi-RP eller etater', type: 'textarea' },
        { id: 'case', label: 'En mistenkt nekter å stoppe ved en kontroll. Hvordan håndterer du situasjonen?', type: 'textarea', req: 1 }]
    },
    ambulanse: {
      title: 'Ambulanse', group: 'Stillinger',
      intro: 'Helse-RP med eget akuttmottak, triage og behandlingsforløp.',
      q: [AGE, DISC, TID,
        { id: 'hvorfor', label: 'Hvorfor vil du jobbe i helsevesenet?', type: 'textarea', req: 1 },
        { id: 'case', label: 'Du kommer til en trafikkulykke med tre skadde. Hvem behandler du først, og hvorfor?', type: 'textarea', req: 1 }]
    },
    mekaniker: {
      title: 'Mekaniker', group: 'Stillinger',
      intro: 'Reparer, tun og berg kjøretøy for byens innbyggere.',
      q: [AGE, DISC, TID,
        { id: 'hvorfor', label: 'Hvorfor vil du jobbe som mekaniker?', type: 'textarea', req: 1 }]
    },
    selger: {
      title: 'Bilselger', group: 'Stillinger',
      intro: 'Selg nye og brukte biler hos Bergeland Bil.',
      q: [AGE, DISC, TID,
        { id: 'hvorfor', label: 'Hvorfor passer du som bilselger?', type: 'textarea', req: 1 }]
    },
    bedrift: {
      title: 'Bedrift', group: 'Bedrift',
      intro: 'Søk om å starte eller overta en bedrift. Beskriv konseptet grundig.',
      q: [AGE, DISC,
        { id: 'navn', label: 'Navn på bedriften', type: 'text', req: 1 },
        { id: 'type', label: 'Type bedrift', type: 'select', options: ['Restaurant / kafé', 'Bilforhandler', 'Verksted', 'Butikk', 'Underholdning', 'Annet'], req: 1 },
        { id: 'konsept', label: 'Beskriv konseptet og hvordan bedriften skaper RP for andre.', type: 'textarea', req: 1, min: 200 },
        { id: 'ansatte', label: 'Hvem skal jobbe der? Har du allerede ansatte?', type: 'textarea', req: 1 }]
    },
    gjeng: {
      title: 'Gjeng', group: 'Gjeng',
      intro: 'Kriminelle grupperinger må godkjennes av staff før de kan operere i byen.',
      q: [DISC,
        { id: 'navn', label: 'Navn på gjengen', type: 'text', req: 1 },
        { id: 'leder', label: 'Hvem er leder (karakternavn)?', type: 'text', req: 1 },
        { id: 'medlemmer', label: 'Antall medlemmer', type: 'select', options: ['3–5', '6–9', '10–12'], req: 1 },
        { id: 'historie', label: 'Gjengens historie og bakgrunn', type: 'textarea', req: 1, min: 300 },
        { id: 'mal', label: 'Hva er målet til gjengen, og hvordan skaper dere RP for andre enn dere selv?', type: 'textarea', req: 1 }]
    },
    staff: {
      title: 'Staff', group: 'Staff',
      intro: 'Staff holder serveren trygg og rettferdig. Vi ser etter rolige, ærlige og aktive spillere.',
      q: [AGE, DISC, TID,
        { id: 'erf', label: 'Tidligere staff-erfaring', type: 'textarea', req: 1 },
        { id: 'hvorfor', label: 'Hvorfor vil du bli staff i Novex?', type: 'textarea', req: 1 },
        { id: 'case', label: 'En venn av deg bryter reglene og blir rapportert. Hvordan håndterer du saken?', type: 'textarea', req: 1 }]
    }
  };

  /* open: false stenger stillingen både på siden og på serveren */
  const JOBS = [
    { k: 'politi', kind: 'Etat', open: true, plass: '4 ledige', desc: 'Patrulje, etterforskning og utrykning. Opplæring etter opptak.' },
    { k: 'ambulanse', kind: 'Etat', open: true, plass: '3 ledige', desc: 'Akuttmottak, ambulanse og behandling. Opplæring gis.' },
    { k: 'mekaniker', kind: 'Novex Motorverksted', open: true, plass: '2 ledige', desc: 'Kvelds- og helgevakter på verkstedet.' },
    { k: 'selger', kind: 'Bergeland Bil', open: true, plass: '1 ledig', desc: 'Salg av nye og brukte biler i sentrum.' }
  ];

  const CATS = ['Spørsmål', 'Rapporter spiller', 'Bug / feil', 'Refusjon', 'Klage på staff', 'Annet'];

  function validate(form, answers) {
    const f = FORMS[form];
    const errors = {};
    if (!f) return { _: 'Ukjent søknadstype.' };
    f.q.forEach(function (q) {
      const raw = answers && answers[q.id];
      const v = String(raw == null ? '' : raw).trim();
      if (q.req && !v) errors[q.id] = 'Dette feltet må fylles ut.';
      else if (q.min && v.length < q.min) errors[q.id] = 'Skriv minst ' + q.min + ' tegn. Du har ' + v.length + '.';
      else if (q.type === 'select' && v && q.options.indexOf(v) < 0) errors[q.id] = 'Velg et av alternativene.';
      else if (q.must && v && v !== q.must) errors[q.id] = 'Du må lese regelverket før du søker.';
      else if (q.type === 'number' && v && !/^\d{1,2}$/.test(v)) errors[q.id] = 'Skriv et gyldig tall.';
      else if (q.id === 'alder' && v && Number(v) < 16) errors[q.id] = 'Du må være minst 16 år for å søke.';
    });
    return errors;
  }

  /* Rettigheter for staff. Eieren (STAFF_DISCORD_IDS) har alltid alle. */
  const PERMS = [
    { k: 'tickets.view', label: 'Se og svare på tickets', desc: 'Ser alle tickets på nettsiden og i Discord, og kan svare som staff.' },
    { k: 'tickets.close', label: 'Lukke og slette tickets', desc: 'Kan lukke, åpne igjen og slette ticket-kanaler.' },
    { k: 'apps.whitelist', label: 'Behandle whitelist-søknader', desc: 'Godkjenne og avslå whitelist.' },
    { k: 'apps.jobs', label: 'Behandle jobb-, bedrift- og gjengsøknader', desc: 'Politi, ambulanse, mekaniker, bilselger, bedrift og gjeng.' },
    { k: 'apps.staff', label: 'Behandle staff-søknader', desc: 'Godkjenne og avslå nye staff.' },
    { k: 'discord.manage', label: 'Discord-oppsett', desc: 'Registrere kommandoer og legge ut ticket-panelet.' },
    { k: 'staff.manage', label: 'Administrere staff', desc: 'Legge til og fjerne staff. Kan bare gi rettigheter de har selv.' }
  ];
  const PERM_KEYS = PERMS.map(function (p) { return p.k; });
  const PRESETS = [
    { name: 'Support', perms: ['tickets.view'] },
    { name: 'Moderator', perms: ['tickets.view', 'tickets.close', 'apps.whitelist'] },
    { name: 'Admin', perms: ['tickets.view', 'tickets.close', 'apps.whitelist', 'apps.jobs', 'apps.staff', 'discord.manage'] },
    { name: 'Head Admin', perms: PERM_KEYS.slice() }
  ];
  function appPerm(form) { return form === 'whitelist' ? 'apps.whitelist' : form === 'staff' ? 'apps.staff' : 'apps.jobs'; }

  const api = { FORMS: FORMS, JOBS: JOBS, CATS: CATS, validate: validate, PERMS: PERMS, PERM_KEYS: PERM_KEYS, PRESETS: PRESETS, appPerm: appPerm };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NOVEX_FORMS = api;
})(typeof window !== 'undefined' ? window : globalThis);

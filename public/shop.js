/* Bedrifter som selges i butikken på nettsiden.
   Brukes av både nettsiden og serveren, så endringer her gjelder begge steder.

   Slik kobler du butikken til Tebex:
   1. Lag én pakke per type i Tebex (Packages → Create Package): Bensinstasjon, Dagligvare, Kafé og Mekaniker.
   2. Kopier pakke-ID-en (tallet i adressen når du redigerer pakken) inn i feltet tebex på typen under.
   3. Prisen her vises bare på nettsiden. Det er prisen i Tebex som faktisk trekkes. Hold dem like.
   Spilleren velger sted på nettsiden før hen betaler, og stedet holdes av mens hen betaler. */
(function (root) {
  'use strict';

  /* Én type per kort i butikken. Spilleren velger selv sted når hen kjøper.
     tebex: ID-en til Tebex-pakken for denne typen. Én pakke per type holder.
     price er i hele kroner og vises bare på nettsiden. Hold den lik prisen i Tebex. */
  const TYPES = {
    bensin: {
      label: 'Bensinstasjon', plural: 'Bensinstasjoner', mark: 'BS', price: 749, tebex: '',
      desc: 'Selg drivstoff, snacks og bilpleie. Sett egne priser og ansett folk til kassa.',
      includes: ['Egen stasjon med pumper og butikk', 'Sett drivstoffpris selv', 'Lager og kasse', 'Ansett opptil 6 personer']
    },
    dagligvare: {
      label: 'Dagligvare', plural: 'Dagligvare', mark: 'DV', price: 599, tebex: '',
      desc: 'Byens matbutikk. Bestill varer, fyll hyllene og hold åpent når folk trenger det.',
      includes: ['Butikklokale med lager', 'Bestill varer fra grossist', 'Sett egne priser', 'Ansett opptil 6 personer']
    },
    kafe: {
      label: 'Kafé', plural: 'Kafeer', mark: 'KF', price: 599, tebex: '',
      desc: 'Kaffe, mat og et sted folk møtes. Lag egen meny og arranger kvelder.',
      includes: ['Kafélokale med kjøkken', 'Egen meny og priser', 'Sitteplasser og musikk', 'Ansett opptil 5 personer']
    },
    mekaniker: {
      label: 'Mekaniker', plural: 'Mekanikere', mark: 'MK', price: 749, tebex: '',
      desc: 'Reparasjon, tuning og bilpleie. Byens biler trenger et sted å bli fikset.',
      includes: ['Verksted med løftebukker', 'Reparasjon og tuning', 'Deleslager', 'Ansett opptil 8 personer']
    }
  };

  /* Stedene spilleren kan velge mellom. Hvert sted kan bare eies av én.
     id må aldri endres etter at stedet er solgt. Legg til eller fjern steder fritt. */
  const PLACES = {
    bensin: [
      { id: 'bensin-sentrum', area: 'Sentrum', note: 'Ved motorveien inn til byen' },
      { id: 'bensin-mirror-park', area: 'Mirror Park', note: 'Rolig strøk øst i byen' },
      { id: 'bensin-sandy-shores', area: 'Sandy Shores', note: 'Eneste stasjon i ørkenen' },
      { id: 'bensin-paleto-bay', area: 'Paleto Bay', note: 'Lengst nord, mye trafikk på vei forbi' }
    ],
    dagligvare: [
      { id: 'dagligvare-torget', area: 'Torget', note: 'Midt i sentrum, flest folk' },
      { id: 'dagligvare-vespucci', area: 'Vespucci', note: 'Ved stranda' },
      { id: 'dagligvare-sandy-shores', area: 'Sandy Shores', note: 'Butikken for alle i ørkenen' },
      { id: 'dagligvare-paleto-bay', area: 'Paleto Bay', note: 'Nærbutikken i nord' }
    ],
    kafe: [
      { id: 'kafe-torget', area: 'Torget', note: 'Utsikt over torget' },
      { id: 'kafe-vinewood', area: 'Vinewood', note: 'Der kjendisene henger' },
      { id: 'kafe-del-perro', area: 'Del Perro', note: 'Ved piren' }
    ],
    mekaniker: [
      { id: 'mekaniker-sentrum', area: 'Sentrum', note: 'Stort verksted nær motorveien' },
      { id: 'mekaniker-la-mesa', area: 'La Mesa', note: 'Industriområdet' },
      { id: 'mekaniker-sandy-shores', area: 'Sandy Shores', note: 'Verkstedet i ørkenen' },
      { id: 'mekaniker-paleto-bay', area: 'Paleto Bay', note: 'Verkstedet i nord' }
    ]
  };

  /* alle steder i én liste, med navn og pris fra typen */
  const LISTINGS = [];
  Object.keys(PLACES).forEach(function (type) {
    PLACES[type].forEach(function (pl) {
      LISTINGS.push({ id: pl.id, type: type, area: pl.area, note: pl.note || '', name: TYPES[type].label + ' ' + pl.area, price: TYPES[type].price, tebex: pl.tebex || '' });
    });
  });
  /* Tebex-pakken for et sted: egen pakke hvis stedet har en, ellers pakken for typen */
  function packageOf(l) { return l.tebex || TYPES[l.type].tebex || ''; }

  /* hvor mange bedrifter én spiller kan eie */
  const MAX_PER_PLAYER = 1;
  /* hvor lenge en bedrift holdes av mens spilleren betaler */
  const RESERVE_MINUTES = 20;

  /* vilkår som vises før kjøp. Endre dem slik at de passer serveren din. */
  const TERMS = [
    'Du kjøper retten til å drive bedriften i spillet på Project Novex. Du får ingen penger eller gjenstander utenfor spillet.',
    'Bedriften er knyttet til Discord-kontoen du er logget inn med, og kan ikke selges videre.',
    'Bedriften må holdes aktiv. Staff kan ta den tilbake etter 14 dager uten aktivitet, eller ved brudd på reglene.',
    'Du må være whitelistet og følge regelverket. Kjøpet gir ingen fordeler i saker hos staff.',
    'Spørsmål om kjøp tar du i en ticket med kategorien Refusjon.'
  ];

  const api = { TYPES: TYPES, PLACES: PLACES, LISTINGS: LISTINGS, packageOf: packageOf, MAX_PER_PLAYER: MAX_PER_PLAYER, RESERVE_MINUTES: RESERVE_MINUTES, TERMS: TERMS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NOVEX_SHOP = api;
})(typeof window !== 'undefined' ? window : globalThis);

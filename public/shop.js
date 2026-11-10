/* Bedrifter som selges i butikken på nettsiden.
   Brukes av både nettsiden og serveren, så endringer her gjelder begge steder.

   Slik kobler du en bedrift til Tebex:
   1. Lag en pakke per bedrift i Tebex (Packages → Create Package). Sett «Purchase limit» til 1.
   2. Kopier pakke-ID-en (tallet i adressen når du redigerer pakken) inn i feltet tebex under.
   3. Prisen her vises bare på nettsiden. Det er prisen i Tebex som faktisk trekkes. Hold dem like. */
(function (root) {
  'use strict';

  const TYPES = {
    bensin: {
      label: 'Bensinstasjon', plural: 'Bensinstasjoner', mark: 'BS',
      desc: 'Selg drivstoff, snacks og bilpleie. Sett egne priser og ansett folk til kassa.',
      includes: ['Egen stasjon med pumper og butikk', 'Sett drivstoffpris selv', 'Lager og kasse', 'Ansett opptil 6 personer']
    },
    dagligvare: {
      label: 'Dagligvare', plural: 'Dagligvarebutikker', mark: 'DV',
      desc: 'Byens matbutikk. Bestill varer, fyll hyllene og hold åpent når folk trenger det.',
      includes: ['Butikklokale med lager', 'Bestill varer fra grossist', 'Sett egne priser', 'Ansett opptil 6 personer']
    },
    kafe: {
      label: 'Kafé', plural: 'Kafeer', mark: 'KF',
      desc: 'Kaffe, mat og et sted folk møtes. Lag egen meny og arranger kvelder.',
      includes: ['Kafélokale med kjøkken', 'Egen meny og priser', 'Sitteplasser og musikk', 'Ansett opptil 5 personer']
    },
    mekaniker: {
      label: 'Mekaniker', plural: 'Mekanikerverksteder', mark: 'MK',
      desc: 'Reparasjon, tuning og bilpleie. Byens biler trenger et sted å bli fikset.',
      includes: ['Verksted med løftebukker', 'Reparasjon og tuning', 'Deleslager', 'Ansett opptil 8 personer']
    }
  };

  /* id må aldri endres etter at en bedrift er solgt. price er i hele kroner. */
  const LISTINGS = [
    { id: 'bensin-sentrum', type: 'bensin', name: 'Bensinstasjon Sentrum', area: 'Sentrum', price: 749, tebex: '' },
    { id: 'bensin-motorveien', type: 'bensin', name: 'Bensinstasjon Motorveien', area: 'Motorveien nord', price: 749, tebex: '' },
    { id: 'bensin-orkenen', type: 'bensin', name: 'Bensinstasjon Ørkenen', area: 'Ørkenen', price: 749, tebex: '' },
    { id: 'dagligvare-sentrum', type: 'dagligvare', name: 'Dagligvare Sentrum', area: 'Sentrum', price: 599, tebex: '' },
    { id: 'dagligvare-havna', type: 'dagligvare', name: 'Dagligvare Havna', area: 'Havna', price: 599, tebex: '' },
    { id: 'dagligvare-nord', type: 'dagligvare', name: 'Dagligvare Nord', area: 'Nord', price: 599, tebex: '' },
    { id: 'kafe-torget', type: 'kafe', name: 'Kafé Torget', area: 'Sentrum', price: 599, tebex: '' },
    { id: 'kafe-stranda', type: 'kafe', name: 'Kafé Stranda', area: 'Vest', price: 599, tebex: '' },
    { id: 'mekaniker-sentrum', type: 'mekaniker', name: 'Mekaniker Sentrum', area: 'Sentrum', price: 749, tebex: '' },
    { id: 'mekaniker-nord', type: 'mekaniker', name: 'Mekaniker Nord', area: 'Nord', price: 749, tebex: '' }
  ];

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

  const api = { TYPES: TYPES, LISTINGS: LISTINGS, MAX_PER_PLAYER: MAX_PER_PLAYER, RESERVE_MINUTES: RESERVE_MINUTES, TERMS: TERMS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NOVEX_SHOP = api;
})(typeof window !== 'undefined' ? window : globalThis);

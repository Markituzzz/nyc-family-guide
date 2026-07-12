import fs from 'node:fs/promises';

const source = JSON.parse(await fs.readFile(new URL('../work/source_workbook.json', import.meta.url), 'utf8'));

const clean = value => String(value ?? '').replace(/\u00a0/g, ' ').trim();
const decimal = value => {
  const parsed = Number(clean(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};
const duration = value => {
  const text = clean(value).toLowerCase().replace(/–|—/g, '-');
  const numbers = [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map(match => Number(match[0].replace(',', '.')));
  if (!numbers.length) return { minMinutes: null, idealMinutes: null, maxMinutes: null };
  const multiplier = /\bh\b|hora/.test(text) ? 60 : 1;
  const minMinutes = Math.round(numbers[0] * multiplier);
  const maxMinutes = Math.round((numbers[1] ?? numbers[0]) * multiplier);
  return { minMinutes, idealMinutes: Math.round((minMinutes + maxMinutes) / 2), maxMinutes };
};
const setting = value => {
  const text = clean(value).toLowerCase();
  const inside = text.includes('indoor') || text.includes('interior');
  const outside = text.includes('exterior') || text.includes('outdoor');
  if (text.includes('mixto') || (inside && outside)) return 'mixto';
  if (inside) return 'interior';
  if (outside) return 'exterior';
  return '';
};
const rowsToObjects = rows => {
  const normalized = rows.map(row => row.map(clean)).filter(row => row.some(Boolean));
  const headers = normalized[0];
  return normalized.slice(1).map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
};

const places = rowsToObjects(source.Lugares).map((place, index) => ({
  id: /^\d+$/.test(place.id) ? `PLC-${place.id.padStart(4, '0')}` : place.id || `PLC-${String(index + 1).padStart(4, '0')}`,
  itemKind: 'place',
  name: place.name,
  type: place.type,
  subtype: place.subtype,
  category: place.category,
  borough: place.borough,
  area: place.area,
  cluster: place.cluster,
  macroAnchor: place.macroAnchor,
  anchorLevel: place.anchorLevel,
  priority: place.priority,
  familyFit: place.familyFit,
  teenFit: place.teenFit,
  adultFit: place.adultFit,
  whyItMatters: place.whyItMatters,
  bestFor: place.bestFor,
  ifCondition: place.ifCondition,
  timeNeeded: place.timeNeeded,
  ...duration(place.timeNeeded),
  bestMoment: place.bestMoment,
  weatherFit: place.weatherFit,
  setting: setting(place.weatherFit),
  energyLevel: clean(place.energyLevel).toLowerCase(),
  costLevel: clean(place.costLevel).toLowerCase(),
  planRole: place.planRole,
  status: place.status,
  validationStatus: place.validationStatus,
  mapsUrl: place.mapsUrl,
  officialUrl: place.officialUrl,
  lat: decimal(place.lat),
  lng: decimal(place.lng),
  address: place.address,
  price: place.price,
  rating: decimal(place.rating),
  reviews: decimal(place.reviews),
  origin: place.origin || 'editorial',
  notes: place.notes,
  published: clean(place.status).toLowerCase() !== 'descartado'
}));

const experiences = rowsToObjects(source.Experiencias).map(experience => ({
  id: experience.experienceId,
  itemKind: 'experience',
  name: experience.name,
  type: 'Experiencia',
  subtype: experience.experienceType,
  category: experience.experienceType,
  borough: '',
  area: '',
  cluster: '',
  macroAnchor: experience.macroAnchor,
  priority: 'Media',
  whyItMatters: experience.whyItWorks,
  bestFor: experience.familyMechanic,
  ifCondition: experience.trigger,
  timeNeeded: experience.duration,
  ...duration(experience.duration),
  setting: setting(`${experience.trigger} ${experience.experienceType}`),
  energyLevel: /cansancio|calor/i.test(experience.trigger) ? 'bajo' : 'medio',
  costLevel: '',
  mapsUrl: '',
  officialUrl: '',
  lat: null,
  lng: null,
  origin: 'editorial',
  notes: experience.validationNeeded,
  published: true
}));

await fs.mkdir(new URL('../data/', import.meta.url), { recursive: true });
await fs.writeFile(new URL('../data/catalog.json', import.meta.url), JSON.stringify({ generatedAt: new Date().toISOString(), places, experiences }, null, 2));
console.log(`Catálogo generado: ${places.length} lugares y ${experiences.length} experiencias`);

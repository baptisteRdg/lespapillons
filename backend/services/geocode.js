const DEFAULT_TIMEOUT_MS = 1500;
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_QUERY_LENGTH = 200;

const memoryCache = new Map();
const inflightRequests = new Map();

function nowMs() {
    return Date.now();
}

function parsePositiveInt(value, fallback) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const GEOCODE_TIMEOUT_MS = parsePositiveInt(process.env.GEOCODE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
const GEOCODE_CACHE_TTL_MS = parsePositiveInt(process.env.GEOCODE_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS);

function normalizeQuery(query) {
    return String(query || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, MAX_QUERY_LENGTH);
}

function cacheKey(query, providerMode = 'auto') {
    return `${providerMode}:${query.toLowerCase()}`;
}

function getCache(key) {
    const entry = memoryCache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= nowMs()) {
        memoryCache.delete(key);
        return null;
    }
    return entry.value;
}

function setCache(key, value) {
    memoryCache.set(key, {
        value,
        expiresAt: nowMs() + GEOCODE_CACHE_TTL_MS
    });
}

function inferPlaceTypeFromLabel(query, label) {
    const value = `${query} ${label}`.toLowerCase();
    const looksLikeAddress =
        /\d/.test(value) ||
        /\b(rue|avenue|av\.|boulevard|bd|place|impasse|all[ée]e|chemin|route|quai|square|cours)\b/.test(value);
    return looksLikeAddress ? 'address' : 'poi';
}

const NOMINATIM_CITY_TYPES = new Set([
    'city',
    'town',
    'village',
    'municipality',
    'hamlet',
    'suburb',
    'borough',
    'district',
    'county',
    'region',
    'state'
]);
const NOMINATIM_ADDRESS_TYPES = new Set([
    'house',
    'building',
    'road',
    'street',
    'residential',
    'house_number',
    'postcode'
]);
const NOMINATIM_POI_CLASSES = new Set([
    'amenity',
    'tourism',
    'leisure',
    'shop',
    'craft',
    'office',
    'healthcare',
    'building'
]);

const MAPBOX_CITY_TYPES = new Set(['place', 'locality', 'region', 'district', 'country']);
const MAPBOX_ADDRESS_TYPES = new Set(['address', 'postcode']);
const MAPBOX_POI_TYPES = new Set(['poi']);

function classifyNominatimPlace(query, top) {
    const itemType = String(top?.addresstype || top?.type || '').toLowerCase();
    const itemClass = String(top?.class || '').toLowerCase();
    if (NOMINATIM_POI_CLASSES.has(itemClass)) return 'poi';
    if (NOMINATIM_ADDRESS_TYPES.has(itemType)) return 'address';
    if (NOMINATIM_CITY_TYPES.has(itemType)) return 'city';
    return inferPlaceTypeFromLabel(query, `${itemType} ${itemClass} ${top?.display_name || ''}`);
}

function classifyMapboxPlace(query, top) {
    const placeTypes = Array.isArray(top?.place_type)
        ? top.place_type.map((type) => String(type || '').toLowerCase())
        : [];

    if (placeTypes.some((type) => MAPBOX_POI_TYPES.has(type))) return 'poi';
    if (placeTypes.some((type) => MAPBOX_ADDRESS_TYPES.has(type))) return 'address';
    if (placeTypes.some((type) => MAPBOX_CITY_TYPES.has(type))) return 'city';
    return inferPlaceTypeFromLabel(query, `${placeTypes.join(' ')} ${top?.place_name || ''}`);
}

function toNominatimResult(query, top, durationMs) {
    const lat = parseFloat(top?.lat);
    const lng = parseFloat(top?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const label = top.display_name || query;
    return {
        provider: 'nominatim',
        label,
        lat,
        lng,
        placeType: classifyNominatimPlace(query, top),
        bbox: toLeafletBboxFromNominatim(top.boundingbox),
        durationMs
    };
}

function toMapboxResult(query, top, durationMs) {
    const center = top?.center || [];
    const lng = parseFloat(center[0]);
    const lat = parseFloat(center[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const label = top.place_name || query;
    return {
        provider: 'mapbox',
        label,
        lat,
        lng,
        placeType: classifyMapboxPlace(query, top),
        bbox: toLeafletBboxFromMapbox(top.bbox),
        durationMs
    };
}

function normalizeGeocodeLimit(rawLimit, fallback) {
    const parsed = parsePositiveInt(rawLimit, fallback);
    return Math.min(10, Math.max(1, parsed));
}

function dedupeGeocodeResults(results) {
    const seen = new Set();
    return results.filter((item) => {
        const key = `${item.label.toLowerCase()}|${item.lat.toFixed(5)}|${item.lng.toFixed(5)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function isLocationPreviewCandidate(result) {
    return result.placeType === 'city' || result.placeType === 'address';
}

function geocodeCacheKey(query, providerMode = 'auto') {
    return `single:${providerMode}:${query.toLowerCase()}`;
}

function suggestionCacheKey(query, providerMode = 'auto', limit = 3) {
    return `suggest:${providerMode}:${limit}:${query.toLowerCase()}`;
}

function toLeafletBboxFromNominatim(raw) {
    if (!Array.isArray(raw) || raw.length !== 4) return null;
    const south = parseFloat(raw[0]);
    const north = parseFloat(raw[1]);
    const west = parseFloat(raw[2]);
    const east = parseFloat(raw[3]);
    if (![south, north, west, east].every(Number.isFinite)) return null;
    return { south, west, north, east };
}

function toLeafletBboxFromMapbox(raw) {
    if (!Array.isArray(raw) || raw.length !== 4) return null;
    const west = parseFloat(raw[0]);
    const south = parseFloat(raw[1]);
    const east = parseFloat(raw[2]);
    const north = parseFloat(raw[3]);
    if (![south, north, west, east].every(Number.isFinite)) return null;
    return { south, west, north, east };
}

function chooseProviders(providerMode = 'auto') {
    if (providerMode === 'mapbox') return ['mapbox'];
    if (providerMode === 'nominatim') return ['nominatim'];
    return process.env.MAPBOX_ACCESS_TOKEN
        ? ['mapbox', 'nominatim']
        : ['nominatim'];
}

function isLastProvider(index, providers) {
    return index === providers.length - 1;
}

async function geocodeWithProvider(provider, query, options = {}) {
    return provider === 'mapbox'
        ? geocodeWithMapbox(query, options)
        : geocodeWithNominatim(query, options);
}

async function geocodeWithNominatim(query, options = {}) {
    const limit = normalizeGeocodeLimit(options.limit, 1);
    const shouldReturnMany = options.multiple === true;
    const userAgent = process.env.GEOCODE_USER_AGENT || 'LesPapillons/1.0 (contact: admin@beout.fr)';
    const endpoint = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search';
    const params = new URLSearchParams({
        q: query,
        format: 'jsonv2',
        limit: String(limit),
        addressdetails: '1'
    });
    const countryCodes = process.env.GEOCODE_COUNTRY_CODES || 'fr';
    if (countryCodes) params.set('countrycodes', countryCodes);

    const email = process.env.NOMINATIM_EMAIL;
    if (email) params.set('email', email);

    const startedAt = nowMs();
    const response = await fetch(`${endpoint}?${params.toString()}`, {
        headers: {
            'User-Agent': userAgent,
            'Accept': 'application/json',
            'Accept-Language': 'fr'
        },
        signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS)
    });

    if (!response.ok) {
        throw new GeocodeError('Service de géocodage indisponible', 502);
    }

    const payload = await response.json();
    if (!Array.isArray(payload) || payload.length === 0) {
        return shouldReturnMany ? [] : null;
    }

    const durationMs = nowMs() - startedAt;
    const mapped = payload
        .map((item) => toNominatimResult(query, item, durationMs))
        .filter(Boolean);

    if (!shouldReturnMany) return mapped[0] || null;
    return dedupeGeocodeResults(mapped).slice(0, limit);
}

async function geocodeWithMapbox(query, options = {}) {
    const limit = normalizeGeocodeLimit(options.limit, 1);
    const shouldReturnMany = options.multiple === true;
    const token = process.env.MAPBOX_ACCESS_TOKEN;
    if (!token) throw new GeocodeError('Mapbox non configuré', 503);

    const endpoint = process.env.MAPBOX_GEOCODING_URL || 'https://api.mapbox.com/geocoding/v5/mapbox.places';
    const params = new URLSearchParams({
        access_token: token,
        language: 'fr',
        limit: String(limit),
        autocomplete: shouldReturnMany ? 'true' : 'false'
    });

    const startedAt = nowMs();
    const response = await fetch(`${endpoint}/${encodeURIComponent(query)}.json?${params.toString()}`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS)
    });

    if (!response.ok) {
        throw new GeocodeError('Service de géocodage indisponible', 502);
    }

    const payload = await response.json();
    const features = Array.isArray(payload?.features) ? payload.features : [];
    if (features.length === 0) return shouldReturnMany ? [] : null;

    const durationMs = nowMs() - startedAt;
    const mapped = features
        .map((item) => toMapboxResult(query, item, durationMs))
        .filter(Boolean);

    if (!shouldReturnMany) return mapped[0] || null;
    return dedupeGeocodeResults(mapped).slice(0, limit);
}

class GeocodeError extends Error {
    constructor(message, statusCode = 500) {
        super(message);
        this.name = 'GeocodeError';
        this.statusCode = statusCode;
    }
}

function normalizeProviderMode(rawMode) {
    const mode = String(rawMode || 'auto').toLowerCase();
    if (mode === 'auto' || mode === 'mapbox' || mode === 'nominatim') return mode;
    throw new GeocodeError('Provider invalide (valeurs autorisées: auto, mapbox, nominatim)', 400);
}

async function geocodeQuery(rawQuery, options = {}) {
    const query = normalizeQuery(rawQuery);
    if (!query) throw new GeocodeError('Paramètre "q" manquant', 400);
    if (query.length < 2) throw new GeocodeError('La recherche doit contenir au moins 2 caractères', 400);

    const providerMode = normalizeProviderMode(options.provider);
    const providers = chooseProviders(providerMode);
    const key = geocodeCacheKey(query, providerMode);

    const cached = getCache(key);
    if (cached) {
        return { ...cached, cacheHit: true, durationMs: 0 };
    }

    if (inflightRequests.has(key)) {
        return inflightRequests.get(key);
    }

    const task = (async () => {
        try {
            let lastError = null;

            for (let i = 0; i < providers.length; i++) {
                const provider = providers[i];
                try {
                    const result = await geocodeWithProvider(provider, query, { limit: 1, multiple: false });
                    if (result) {
                        setCache(key, result);
                        return { ...result, cacheHit: false };
                    }
                } catch (error) {
                    lastError = error;
                    if (isLastProvider(i, providers)) break;
                    console.warn(`geocode fallback ${provider} -> ${providers[i + 1]}`);
                }
            }

            if (lastError) throw lastError;
            return null;
        } catch (error) {
            if (error?.name === 'TimeoutError') {
                throw new GeocodeError('Le service de géocodage est trop lent', 504);
            }
            if (error instanceof GeocodeError) throw error;
            throw new GeocodeError('Erreur de géocodage', 500);
        } finally {
            inflightRequests.delete(key);
        }
    })();

    inflightRequests.set(key, task);
    return task;
}

async function geocodeSuggestions(rawQuery, options = {}) {
    const query = normalizeQuery(rawQuery);
    if (!query) throw new GeocodeError('Paramètre "q" manquant', 400);
    if (query.length < 3) throw new GeocodeError('La recherche doit contenir au moins 3 caractères', 400);

    const limit = normalizeGeocodeLimit(options.limit, 3);
    const providerMode = normalizeProviderMode(options.provider);
    const providers = chooseProviders(providerMode);
    const key = suggestionCacheKey(query, providerMode, limit);

    const cached = getCache(key);
    if (cached) {
        return {
            results: cached.results,
            provider: cached.provider,
            cacheHit: true,
            durationMs: 0
        };
    }

    if (inflightRequests.has(key)) {
        return inflightRequests.get(key);
    }

    const task = (async () => {
        try {
            let lastError = null;
            for (let i = 0; i < providers.length; i++) {
                const provider = providers[i];
                try {
                    const results = await geocodeWithProvider(provider, query, { multiple: true, limit });
                    const filtered = dedupeGeocodeResults(results.filter(isLocationPreviewCandidate)).slice(0, limit);
                    if (filtered.length > 0) {
                        const payload = {
                            results: filtered,
                            provider,
                            cacheHit: false,
                            durationMs: Math.max(...filtered.map((item) => item.durationMs || 0), 0)
                        };
                        setCache(key, { results: payload.results, provider: payload.provider });
                        return payload;
                    }
                } catch (error) {
                    lastError = error;
                    if (isLastProvider(i, providers)) break;
                    console.warn(`geocode suggest fallback ${provider} -> ${providers[i + 1]}`);
                }
            }

            if (lastError) throw lastError;
            return { results: [], provider: providers[0], cacheHit: false, durationMs: 0 };
        } catch (error) {
            if (error?.name === 'TimeoutError') {
                throw new GeocodeError('Le service de géocodage est trop lent', 504);
            }
            if (error instanceof GeocodeError) throw error;
            throw new GeocodeError('Erreur de suggestions de géocodage', 500);
        } finally {
            inflightRequests.delete(key);
        }
    })();

    inflightRequests.set(key, task);
    return task;
}

module.exports = {
    geocodeQuery,
    geocodeSuggestions,
    GeocodeError
};

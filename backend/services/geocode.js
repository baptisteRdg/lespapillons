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

function cacheKey(query, provider) {
    return `${provider}:${query.toLowerCase()}`;
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
    return looksLikeAddress ? 'address' : 'city';
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

function chooseProvider() {
    return process.env.MAPBOX_ACCESS_TOKEN ? 'mapbox' : 'nominatim';
}

async function geocodeWithNominatim(query) {
    const userAgent = process.env.GEOCODE_USER_AGENT || 'LesPapillons/1.0 (contact: admin@beout.fr)';
    const endpoint = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search';
    const params = new URLSearchParams({
        q: query,
        format: 'jsonv2',
        limit: '1',
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
    if (!Array.isArray(payload) || payload.length === 0) return null;

    const top = payload[0];
    const lat = parseFloat(top.lat);
    const lng = parseFloat(top.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const label = top.display_name || query;
    const placeType = inferPlaceTypeFromLabel(query, `${top.type || ''} ${top.class || ''} ${label}`);

    return {
        provider: 'nominatim',
        label,
        lat,
        lng,
        placeType,
        bbox: toLeafletBboxFromNominatim(top.boundingbox),
        durationMs: nowMs() - startedAt
    };
}

async function geocodeWithMapbox(query) {
    const token = process.env.MAPBOX_ACCESS_TOKEN;
    if (!token) throw new GeocodeError('Mapbox non configuré', 500);

    const endpoint = process.env.MAPBOX_GEOCODING_URL || 'https://api.mapbox.com/geocoding/v5/mapbox.places';
    const params = new URLSearchParams({
        access_token: token,
        language: 'fr',
        limit: '1',
        autocomplete: 'false'
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
    const top = payload?.features?.[0];
    if (!top) return null;

    const center = top.center || [];
    const lng = parseFloat(center[0]);
    const lat = parseFloat(center[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const label = top.place_name || query;
    const joinedType = Array.isArray(top.place_type) ? top.place_type.join(' ') : '';
    const placeType = inferPlaceTypeFromLabel(query, `${joinedType} ${label}`);

    return {
        provider: 'mapbox',
        label,
        lat,
        lng,
        placeType,
        bbox: toLeafletBboxFromMapbox(top.bbox),
        durationMs: nowMs() - startedAt
    };
}

class GeocodeError extends Error {
    constructor(message, statusCode = 500) {
        super(message);
        this.name = 'GeocodeError';
        this.statusCode = statusCode;
    }
}

async function geocodeQuery(rawQuery) {
    const query = normalizeQuery(rawQuery);
    if (!query) throw new GeocodeError('Paramètre "q" manquant', 400);
    if (query.length < 2) throw new GeocodeError('La recherche doit contenir au moins 2 caractères', 400);

    const provider = chooseProvider();
    const key = cacheKey(query, provider);

    const cached = getCache(key);
    if (cached) {
        return { ...cached, cacheHit: true, durationMs: 0 };
    }

    if (inflightRequests.has(key)) {
        return inflightRequests.get(key);
    }

    const task = (async () => {
        try {
            const result = provider === 'mapbox'
                ? await geocodeWithMapbox(query)
                : await geocodeWithNominatim(query);
            if (result) setCache(key, result);
            return result ? { ...result, cacheHit: false } : null;
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

module.exports = {
    geocodeQuery,
    GeocodeError
};

/**
 * Module Account — Panneau de compte utilisateur
 * Gère le drawer de profil, les amis, les listes activités.
 */

// ── Ouverture / fermeture ─────────────────────────────────────────────────────

function openAccountPanel() {
    const panel = document.getElementById('account-panel');
    if (!panel) return;
    panel.classList.add('open');
    _loadAccountData();
}

function closeAccountPanel() {
    document.getElementById('account-panel')?.classList.remove('open');
    _openMemberPickerGroupId = null;
}

let _friendsCache = [];
let _groupsCache = [];
let _expandedGroupId = null;
let _openMemberPickerGroupId = null;
let _activeGroupId = null;
let _groupPickerActivityId = null;
let _groupPickerActivityTitle = '';

// ── Chargement des données ────────────────────────────────────────────────────

async function _loadAccountData() {
    const user = getCurrentUser();
    if (!user) return;

    // Profil
    _renderProfile(user);

    // Listes (chargées à la demande via accordéons, on précharge quand le panel s'ouvre)
    await Promise.all([
        _loadFriends(),
        _loadGroups(),
        _loadTodo(),
        _loadDone()
    ]);
}

function _renderProfile(user) {
    // Avatar — resolveAvatarUrl est défini dans api.js (chargé avant account.js)
    const avatarEl = document.getElementById('account-avatar-display');
    if (avatarEl) {
        const avatarUrl = resolveAvatarUrl(user.avatar);
        if (avatarUrl) {
            avatarEl.innerHTML = `<img src="${avatarUrl}" alt="Avatar" class="account-avatar-img">`;
        } else {
            const initials = (user.pseudo || '?').slice(0, 2).toUpperCase();
            avatarEl.innerHTML = `<span class="account-initials-lg">${initials}</span>`;
        }
    }

    // Pseudo
    const pseudoEl = document.getElementById('account-pseudo-display');
    if (pseudoEl) pseudoEl.textContent = user.pseudo;

    // Téléphone masqué (garder uniquement les 4 derniers chiffres)
    const phoneEl = document.getElementById('account-phone-display');
    if (phoneEl && user.phone) {
        const masked = user.phone.replace(/\d(?=\d{4})/g, '•');
        phoneEl.textContent = masked;
    }
}

// ── Amis ──────────────────────────────────────────────────────────────────────

async function _loadFriends() {
    try {
        const res  = await _authFetch(`${getApiBaseUrl()}/users/me/friends`);
        const data = await res.json();
        if (!data.success) return;

        _friendsCache = data.friends || [];
        _renderFriendRequests(data.requests || []);
        _renderFriends(_friendsCache);
        _renderGroups();
    } catch (err) {
        console.error('Erreur chargement amis:', err);
    }
}

function _renderFriendRequests(requests) {
    const container = document.getElementById('friend-requests-list');
    if (!container) return;

    if (!requests.length) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    container.innerHTML = `<p class="account-section-label">${T.LABELS.FRIEND_REQUESTS}</p>` +
        requests.map(r => `
            <div class="friend-request-item" data-id="${r.id}">
                <div class="friend-avatar-sm">${r.from.pseudo.slice(0, 2).toUpperCase()}</div>
                <span class="friend-name">${escapeHtml(r.from.pseudo)}</span>
                <div class="friend-request-actions">
                    <button class="fq-accept-btn account-btn-primary-sm" data-id="${r.id}">
                        <i class="fas fa-check"></i>
                    </button>
                    <button class="fq-reject-btn account-btn-danger-sm" data-id="${r.id}">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>
        `).join('');

    container.querySelectorAll('.fq-accept-btn').forEach(btn =>
        btn.addEventListener('click', () => _respondFriendRequest(btn.dataset.id, 'accept'))
    );
    container.querySelectorAll('.fq-reject-btn').forEach(btn =>
        btn.addEventListener('click', () => _respondFriendRequest(btn.dataset.id, 'reject'))
    );
}

function _renderFriends(friends) {
    const container = document.getElementById('friends-list');
    if (!container) return;

    if (!friends.length) {
        container.innerHTML = `<p class="account-empty-msg">${T.EMPTY.FRIENDS}</p>`;
        return;
    }

    container.innerHTML = friends.map(f => `
        <div class="friend-item" data-id="${f.id}">
            <div class="friend-avatar-sm">${f.pseudo.slice(0, 2).toUpperCase()}</div>
            <span class="friend-name">${escapeHtml(f.pseudo)}</span>
            <button class="friend-remove-btn" data-id="${f.id}" title="${T.BUTTONS.DELETE}">
                <i class="fas fa-user-minus"></i>
            </button>
        </div>
    `).join('');

    container.querySelectorAll('.friend-remove-btn').forEach(btn =>
        btn.addEventListener('click', () => _removeFriend(btn.dataset.id))
    );
}

async function _sendFriendRequest() {
    const input = document.getElementById('friend-pseudo-input');
    const pseudo = input?.value?.trim();
    if (!pseudo) return;

    try {
        const res  = await _authFetch(`${getApiBaseUrl()}/users/friends/request/${encodeURIComponent(pseudo)}`, { method: 'POST' });
        const data = await res.json();
        showToast(data.message || T.TOASTS.FRIEND_REQUEST_SENT, data.success ? 'success' : 'error');
        if (data.success) {
            input.value = '';
            await _loadFriends();
        }
    } catch {
        showToast(T.TOASTS.NETWORK_ERROR, 'error');
    }
}

async function _respondFriendRequest(requestId, action) {
    try {
        const res  = await _authFetch(`${getApiBaseUrl()}/users/friends/requests/${requestId}`, {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ action })
        });
        const data = await res.json();
        showToast(data.message || '', data.success ? 'success' : 'error');
        if (data.success) await _loadFriends();
    } catch {
        showToast(T.TOASTS.NETWORK_ERROR, 'error');
    }
}

async function _removeFriend(friendId) {
    try {
        const res  = await _authFetch(`${getApiBaseUrl()}/users/friends/${friendId}`, { method: 'DELETE' });
        const data = await res.json();
        showToast(data.message || T.TOASTS.FRIEND_REMOVED, 'info');
        if (data.success) {
            await _loadFriends();
            await _loadGroups();
        }
    } catch {
        showToast(T.TOASTS.NETWORK_ERROR, 'error');
    }
}

// ── Groupes ───────────────────────────────────────────────────────────────────

function _upsertGroupInCache(group) {
    const idx = _groupsCache.findIndex((g) => g.id === group.id);
    if (idx >= 0) _groupsCache[idx] = group;
    else _groupsCache.push(group);
}

async function _loadGroups() {
    try {
        const res = await _authFetch(`${getApiBaseUrl()}/groups`);
        const data = await res.json();
        if (!data.success) return;
        _groupsCache = data.data || [];

        if (_expandedGroupId && !_groupsCache.some((g) => g.id === _expandedGroupId)) {
            _expandedGroupId = null;
            _openMemberPickerGroupId = null;
        }
        if (_activeGroupId && !_groupsCache.some((g) => g.id === _activeGroupId)) {
            _activeGroupId = null;
            if (typeof exitGroupMode === 'function') exitGroupMode();
        }

        _renderGroups();
        _renderGroupMapViewStatus();
        if (_activeGroupId) {
            const active = _groupsCache.find((g) => g.id === _activeGroupId);
            if (active && typeof enterGroupMode === 'function') enterGroupMode(active);
        }
    } catch (err) {
        console.error('Erreur chargement groupes:', err);
    }
}

function _renderGroups() {
    const container = document.getElementById('groups-list');
    if (!container) return;

    if (!_groupsCache.length) {
        container.innerHTML = `<p class="account-empty-msg">${T.EMPTY.GROUPS}</p>`;
        return;
    }

    const friendMap = new Map((_friendsCache || []).map((f) => [f.id, f]));

    container.innerHTML = _groupsCache.map((g) => `
        <div class="group-item ${_activeGroupId === g.id ? 'group-item-active' : ''}" data-id="${g.id}">
            <button class="group-item-main group-toggle-btn" data-id="${g.id}">
                <div class="group-item-title-row">
                    <span class="group-item-title">${escapeHtml(g.name)}</span>
                    ${g.isOwner ? '<span class="group-owner-badge">créateur</span>' : ''}
                </div>
                <div class="group-item-meta">
                    <span>${g.memberCount} membre(s)</span>
                    <span>•</span>
                    <span>${g.activityCount} activité(s)</span>
                </div>
            </button>
            <div class="group-item-actions">
                <button class="group-view-btn account-btn-primary" data-id="${g.id}">${T.BUTTONS.VIEW_ON_MAP}</button>
            </div>
            ${_expandedGroupId === g.id ? (() => {
                const memberIds = new Set((g.members || []).map((m) => m.id));
                const addableFriends = [...friendMap.values()].filter((f) => !memberIds.has(f.id));
                const isMemberPickerOpen = _openMemberPickerGroupId === g.id;
                return `
                    <div class="group-inline-detail">
                        <div class="group-inline-block">
                            <div class="group-inline-row">
                                <p class="account-section-label">Membres</p>
                                <div class="group-member-picker-wrap">
                                    <button class="account-btn-secondary group-member-picker-toggle" data-id="${g.id}" ${addableFriends.length ? '' : 'disabled'}>
                                        ${T.BUTTONS.ADD_MEMBER}
                                    </button>
                                    ${addableFriends.length ? `
                                        <div class="group-member-picker ${isMemberPickerOpen ? '' : 'hidden'}" data-id="${g.id}">
                                            ${addableFriends.map((f) => `
                                                <button class="group-member-option" data-group-id="${g.id}" data-user-id="${f.id}">
                                                    ${escapeHtml(f.pseudo)}
                                                </button>
                                            `).join('')}
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                            <div class="group-members-list">
                                ${(g.members || []).map((m) => `
                                    <div class="group-member-item"><span>${escapeHtml(m.pseudo)}</span></div>
                                `).join('')}
                            </div>
                        </div>

                        <div class="group-inline-block">
                            <p class="account-section-label">Activités</p>
                            <div class="group-activities-list">
                                ${(g.activities || []).length ? (g.activities || []).map((a) => `
                                    <div class="group-activity-item" data-group-id="${g.id}" data-id="${a.id}" data-lat="${a.latitude}" data-lng="${a.longitude}" data-type="${escapeHtml(a.type)}">
                                        <div class="group-activity-main">
                                            <span class="group-activity-name">${escapeHtml(a.name)}</span>
                                            <span class="group-activity-type">${escapeHtml(a.type)}</span>
                                        </div>
                                        <button class="account-activity-remove group-activity-remove-btn" data-group-id="${g.id}" data-id="${a.id}" title="${T.BUTTONS.REMOVE}">
                                            <i class="fas fa-trash-alt"></i>
                                        </button>
                                    </div>
                                `).join('') : `<p class="account-empty-msg">${T.EMPTY.GROUP_ACTIVITIES}</p>`}
                            </div>
                        </div>
                    </div>
                `;
            })() : ''}
        </div>
    `).join('');

    container.querySelectorAll('.group-toggle-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const groupId = btn.dataset.id;
            _expandedGroupId = _expandedGroupId === groupId ? null : groupId;
            _openMemberPickerGroupId = null;
            _renderGroups();
        });
    });

    container.querySelectorAll('.group-view-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
            await _setGroupMapView(btn.dataset.id);
            closeAccountPanel();
        });
    });

    container.querySelectorAll('.group-member-picker-toggle').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const groupId = btn.dataset.id;
            _openMemberPickerGroupId = _openMemberPickerGroupId === groupId ? null : groupId;
            _renderGroups();
        });
    });

    container.querySelectorAll('.group-member-option').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const groupId = btn.dataset.groupId;
            const userId = btn.dataset.userId;
            _openMemberPickerGroupId = null;
            await _addMemberToGroup(groupId, userId);
        });
    });

    container.querySelectorAll('.group-activity-item').forEach((item) => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.group-activity-remove-btn')) return;
            const id = parseInt(item.dataset.id, 10);
            const lat = parseFloat(item.dataset.lat);
            const lng = parseFloat(item.dataset.lng);
            if (!id || !lat || !lng || typeof map === 'undefined') return;

            const zoom = Math.max(map.getZoom(), 15);
            const pt = map.project([lat, lng], zoom);
            const off = map.unproject(pt.add([0, computeMarkerOffset()]), zoom);
            map.setView(off, zoom);

            let poolEntry = activityPool.get(id);
            let marker;
            if (poolEntry) {
                marker = poolEntry.marker;
            } else {
                const activity = { id, lat, lng, category: item.dataset.type || 'autre' };
                marker = createMarker(activity, false);
                activityPool.set(id, { activity, marker });
            }
            loadAndShowActivityDetails(id, marker);
            closeAccountPanel();
        });
    });

    container.querySelectorAll('.group-activity-remove-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await _removeActivityFromGroup(btn.dataset.groupId, parseInt(btn.dataset.id, 10));
        });
    });
}

async function _createGroup() {
    const input = document.getElementById('group-name-input');
    const name = input?.value?.trim();
    if (!name) return;

    try {
        const res = await _authFetch(`${getApiBaseUrl()}/groups`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        const data = await res.json();
        showToast(data.message || T.TOASTS.GROUP_CREATED, data.success ? 'success' : 'error');
        if (!data.success) return;

        _upsertGroupInCache(data.data);
        _expandedGroupId = data.data.id;
        input.value = '';
        _renderGroups();
    } catch {
        showToast(T.TOASTS.NETWORK_ERROR, 'error');
    }
}

async function _addMemberToGroup(groupId, userId) {
    try {
        const res = await _authFetch(`${getApiBaseUrl()}/groups/${groupId}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        const data = await res.json();
        showToast(data.message || T.TOASTS.GROUP_MEMBER_ADDED, data.success ? 'success' : 'error');
        if (!data.success) return;

        _upsertGroupInCache(data.data);
        _renderGroups();
        if (_activeGroupId === groupId && typeof enterGroupMode === 'function') {
            enterGroupMode(data.data);
        }
    } catch {
        showToast(T.TOASTS.NETWORK_ERROR, 'error');
    }
}

async function _removeActivityFromGroup(groupId, activityId) {
    try {
        const res = await _authFetch(`${getApiBaseUrl()}/groups/${groupId}/activities/${activityId}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        showToast(data.message || T.TOASTS.GROUP_ACTIVITY_REMOVED, data.success ? 'success' : 'error');
        if (!data.success) return;

        _upsertGroupInCache(data.data);
        _renderGroups();
        if (_activeGroupId === groupId && typeof enterGroupMode === 'function') {
            enterGroupMode(data.data);
        }
    } catch {
        showToast(T.TOASTS.NETWORK_ERROR, 'error');
    }
}

function _renderGroupMapViewStatus() {
    const wrap = document.getElementById('group-map-view-actions');
    const label = document.getElementById('group-map-view-label');
    if (!wrap || !label) return;

    const active = _groupsCache.find((g) => g.id === _activeGroupId);
    if (!active) {
        wrap.classList.add('hidden');
        label.textContent = '';
        return;
    }

    wrap.classList.remove('hidden');
    label.textContent = `Vue active: ${active.name}`;
}

async function _setGroupMapView(groupId) {
    const group = _groupsCache.find((g) => g.id === groupId);
    if (!group) return;
    _activeGroupId = group.id;
    if (typeof enterGroupMode === 'function') enterGroupMode(group);
    _renderGroups();
    _renderGroupMapViewStatus();
    showToast(T.TOASTS.GROUP_VIEW_ENABLED(group.name), 'success');
}

function _exitGroupMapView() {
    _activeGroupId = null;
    if (typeof exitGroupMode === 'function') exitGroupMode();
    _renderGroups();
    _renderGroupMapViewStatus();
    showToast(T.TOASTS.GROUP_VIEW_DISABLED, 'info');
}

function _closeGroupPicker() {
    document.getElementById('group-picker-overlay')?.classList.remove('open');
    _groupPickerActivityId = null;
    _groupPickerActivityTitle = '';
    const input = document.getElementById('group-picker-create-input');
    if (input) input.value = '';
    const titleEl = document.getElementById('group-picker-title');
    if (titleEl) titleEl.textContent = T.LABELS.PICK_GROUP;
}

function _renderGroupPickerList() {
    const list = document.getElementById('group-picker-list');
    if (!list) return;

    if (!_groupsCache.length) {
        list.innerHTML = `<p class="account-empty-msg">${T.EMPTY.GROUPS}</p>`;
        return;
    }

    list.innerHTML = _groupsCache.map((g) => `
        <button class="group-picker-item" data-id="${g.id}">
            <span class="group-picker-item-name">${escapeHtml(g.name)}</span>
            <span class="group-picker-item-meta">${g.memberCount} membres · ${g.activityCount} activités</span>
        </button>
    `).join('');

    list.querySelectorAll('.group-picker-item').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!_groupPickerActivityId) return;
            const groupId = btn.dataset.id;
            try {
                const res = await _authFetch(`${getApiBaseUrl()}/groups/${groupId}/activities/${_groupPickerActivityId}`, {
                    method: 'POST'
                });
                const data = await res.json();
                showToast(data.message || T.TOASTS.GROUP_ACTIVITY_ADDED, data.success ? 'success' : 'error');
                if (!data.success) return;
                await _loadGroups();
                _closeGroupPicker();
            } catch {
                showToast(T.TOASTS.NETWORK_ERROR, 'error');
            }
        });
    });
}

async function _openGroupPicker(activityId, activityTitle = '') {
    _groupPickerActivityId = activityId;
    _groupPickerActivityTitle = activityTitle || '';
    await _loadGroups();
    _renderGroupPickerList();
    const titleEl = document.getElementById('group-picker-title');
    if (titleEl) {
        titleEl.textContent = _groupPickerActivityTitle
            ? `${T.LABELS.PICK_GROUP} — ${_groupPickerActivityTitle}`
            : T.LABELS.PICK_GROUP;
    }
    document.getElementById('group-picker-overlay')?.classList.add('open');
}

async function _createGroupFromPicker() {
    if (!_groupPickerActivityId) return;
    const input = document.getElementById('group-picker-create-input');
    const name = input?.value?.trim();
    if (!name) return;

    try {
        const createRes = await _authFetch(`${getApiBaseUrl()}/groups`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        const createData = await createRes.json();
        if (!createData.success) {
            showToast(createData.message || T.TOASTS.GROUP_CREATED, 'error');
            return;
        }

        const addRes = await _authFetch(`${getApiBaseUrl()}/groups/${createData.data.id}/activities/${_groupPickerActivityId}`, {
            method: 'POST'
        });
        const addData = await addRes.json();
        showToast(addData.message || T.TOASTS.GROUP_ACTIVITY_ADDED, addData.success ? 'success' : 'error');
        if (!addData.success) return;

        input.value = '';
        await _loadGroups();
        _closeGroupPicker();
    } catch {
        showToast(T.TOASTS.NETWORK_ERROR, 'error');
    }
}

async function addActivityToActiveGroup(activityId, activityTitle = '') {
    onAuthRequired(async () => {
        await _openGroupPicker(activityId, activityTitle);
    });
}

window.refreshGroupsUI = _loadGroups;

// ── Listes activités ──────────────────────────────────────────────────────────

async function _loadTodo() {
    try {
        const res  = await _authFetch(`${getApiBaseUrl()}/users/me/todo`);
        const data = await res.json();
        _renderActivityList('todo-list', data.data || [], 'todo');
    } catch {}
}

async function _loadDone() {
    try {
        const res  = await _authFetch(`${getApiBaseUrl()}/users/me/done`);
        const data = await res.json();
        _renderActivityList('done-list', data.data || [], 'done');
    } catch {}
}

const RATING_LABELS = T.RATING_LABELS;

function _renderActivityList(containerId, activities, listType) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!activities.length) {
        container.innerHTML = `<p class="account-empty-msg">${listType === 'todo' ? T.EMPTY.TODO : T.EMPTY.DONE}</p>`;
        return;
    }

    container.innerHTML = activities.map(a => {
        const ratingHtml = (listType === 'done' && a.rating)
            ? `<span class="activity-rating-badge rating-${a.rating}" title="${RATING_LABELS[a.rating]}">${a.rating}/5</span>`
            : '';
        const removeAction = listType === 'todo' ? `data-remove-todo="${a.id}"` : `data-remove-done="${a.id}"`;
        return `
            <div class="account-activity-item" data-goto-activity="${a.id}" data-lat="${a.latitude || ''}" data-lng="${a.longitude || ''}" data-type="${escapeHtml(a.type || 'autre')}">
                <div class="account-activity-info">
                    <span class="account-activity-name">${escapeHtml(a.name)}</span>
                    <span class="account-activity-type">${escapeHtml(a.type)}</span>
                    ${ratingHtml}
                </div>
                <button class="account-activity-remove" ${removeAction} title="${T.BUTTONS.REMOVE}">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </div>
        `;
    }).join('');

    container.querySelectorAll('[data-goto-activity]').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.account-activity-remove')) return;
            const id  = parseInt(item.dataset.gotoActivity);
            const lat = parseFloat(item.dataset.lat);
            const lng = parseFloat(item.dataset.lng);
            if (!id || !lat || !lng) return;

            const zoom = Math.max(map.getZoom(), 15);
            const pt   = map.project([lat, lng], zoom);
            const off  = map.unproject(pt.add([0, computeMarkerOffset()]), zoom);
            map.setView(off, zoom);

            let poolEntry = activityPool.get(id);
            let marker;
            if (poolEntry) {
                marker = poolEntry.marker;
            } else {
                const activity = { id, lat, lng, category: item.dataset.type || 'autre' };
                marker = createMarker(activity, false);
                activityPool.set(id, { activity, marker });
            }
            loadAndShowActivityDetails(id, marker);
        });
    });

    container.querySelectorAll('[data-remove-todo]').forEach(btn =>
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await _removeFromList(btn.dataset.removeTodo, 'todo');
            _loadTodo();
        })
    );
    container.querySelectorAll('[data-remove-done]').forEach(btn =>
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await _removeFromList(btn.dataset.removeDone, 'done');
            _loadDone();
        })
    );
}

async function _removeFromList(activityId, listType) {
    try {
        const url = `${getApiBaseUrl()}/users/me/${listType}/${activityId}`;
        const res = await _authFetch(url, { method: 'DELETE' });
        const data = await res.json();
        showToast(data.message || T.TOASTS.REMOVED, 'info');
    } catch {
        showToast(T.TOASTS.NETWORK_ERROR, 'error');
    }
}

// ── Modification profil ───────────────────────────────────────────────────────

function _showPseudoForm() {
    document.getElementById('account-pseudo-form')?.classList.remove('hidden');
    const input = document.getElementById('account-pseudo-input');
    if (input) {
        input.value = getCurrentUser()?.pseudo || '';
        input.focus();
    }
}

function _hidePseudoForm() {
    document.getElementById('account-pseudo-form')?.classList.add('hidden');
}

async function _savePseudo() {
    const pseudo = document.getElementById('account-pseudo-input')?.value?.trim();
    if (!pseudo || pseudo.length < 3) {
        showToast(T.TOASTS.PSEUDO_TOO_SHORT, 'error');
        return;
    }

    try {
        const res  = await _authFetch(`${getApiBaseUrl()}/users/me`, {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ pseudo })
        });
        const data = await res.json();
        if (data.success) {
            // Mettre à jour le user courant en mémoire
            const user = getCurrentUser();
            if (user) user.pseudo = data.user.pseudo;
            _renderProfile(data.user);
            if (typeof _updateAccountButton === 'function') _updateAccountButton();
            showToast(T.TOASTS.PSEUDO_UPDATED, 'success');
            _hidePseudoForm();
        } else {
            showToast(data.message || T.TOASTS.ERROR, 'error');
        }
    } catch {
        showToast(T.TOASTS.NETWORK_ERROR, 'error');
    }
}

// Fichier sélectionné (en attente d'upload)
let _pendingAvatarFile = null;

function _showAvatarForm() {
    const form = document.getElementById('account-avatar-form');
    form?.classList.remove('hidden');
    // Réinitialiser l'état
    _pendingAvatarFile = null;
    _resetAvatarPreview();
    document.getElementById('account-avatar-save-btn')?.setAttribute('disabled', '');
}

function _hideAvatarForm() {
    document.getElementById('account-avatar-form')?.classList.add('hidden');
    _pendingAvatarFile = null;
    _resetAvatarPreview();
}

function _resetAvatarPreview() {
    const preview = document.getElementById('avatar-upload-preview');
    const fileInput = document.getElementById('account-avatar-file-input');
    if (preview) {
        preview.innerHTML = `
            <i class="fas fa-cloud-upload-alt avatar-upload-icon"></i>
            <span class="avatar-upload-hint">${T.LABELS.AVATAR_HINT}</span>
        `;
    }
    if (fileInput) fileInput.value = '';
}

function _onAvatarFileSelected(file) {
    if (!file) return;

    // Seule vérification côté client : la taille (Sharp validera le vrai type côté serveur)
    if (file.size > 8 * 1024 * 1024) {
        showToast(T.TOASTS.IMAGE_TOO_LARGE, 'error');
        return;
    }

    _pendingAvatarFile = file;

    // Prévisualisation
    const reader = new FileReader();
    reader.onload = (e) => {
        const preview = document.getElementById('avatar-upload-preview');
        if (preview) {
            preview.innerHTML = `<img src="${e.target.result}" class="avatar-upload-img-preview" alt="Aperçu">`;
        }
        document.getElementById('account-avatar-save-btn')?.removeAttribute('disabled');
    };
    reader.readAsDataURL(file);
}

async function _saveAvatar() {
    if (!_pendingAvatarFile) {
        showToast(T.TOASTS.NO_FILE, 'error');
        return;
    }

    if (!getAuthToken()) {
        showToast(T.TOASTS.AUTH_REQUIRED_AVATAR, 'error');
        return;
    }

    const saveBtn = document.getElementById('account-avatar-save-btn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = T.BUTTONS.SENDING; }

    try {
        const formData = new FormData();
        formData.append('avatar', _pendingAvatarFile);

        const res = await _authFetch(`${getApiBaseUrl()}/upload/avatar`, {
            method: 'POST',
            body:   formData
            // Ne PAS définir Content-Type : le navigateur le pose lui-même avec le boundary
        });

        // Nginx peut renvoyer du HTML (ex: 413 trop grand) au lieu de JSON
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            showToast(T.TOASTS.SERVER_ERROR_IMAGE(res.status), 'error');
            return;
        }

        const data = await res.json();

        if (data.success) {
            const user = getCurrentUser();
            if (user) user.avatar = data.user.avatar;
            _renderProfile(data.user);
            if (typeof _updateAccountButton === 'function') _updateAccountButton();
            showToast(T.TOASTS.AVATAR_UPDATED, 'success');
            _hideAvatarForm();
        } else {
            showToast(data.message || T.TOASTS.UPLOAD_ERROR, 'error');
        }
    } catch (err) {
        console.error('Erreur upload avatar:', err);
        showToast(T.TOASTS.NETWORK_CHECK, 'error');
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = T.BUTTONS.SAVE; }
    }
}

// ── Utilitaire fetch authentifié ──────────────────────────────────────────────

function _authFetch(url, options = {}) {
    const token = getAuthToken();
    return fetch(url, {
        ...options,
        headers: {
            'Authorization': `Bearer ${token}`,
            ...options.headers
        }
    });
}

// ── Accordéons ────────────────────────────────────────────────────────────────

function _initAccordions() {
    document.querySelectorAll('.account-accordion-toggle').forEach(toggle => {
        toggle.addEventListener('click', () => {
            const targetId = toggle.dataset.target;
            const body     = document.getElementById(targetId);
            if (!body) return;

            const isOpen = !body.classList.contains('hidden');
            body.classList.toggle('hidden', isOpen);
            toggle.querySelector('.accordion-chevron')?.classList.toggle('rotated', !isOpen);
        });
    });
}

// ── Initialisation ─────────────────────────────────────────────────────────────

function initAccountPanel() {
    // Fermer
    document.getElementById('account-close-btn')?.addEventListener('click', closeAccountPanel);
    document.getElementById('account-backdrop')?.addEventListener('click', closeAccountPanel);

    // Déconnexion
    document.getElementById('account-logout-btn')?.addEventListener('click', () => {
        if (typeof logout === 'function') logout();
        closeAccountPanel();
    });

    // Modifier pseudo
    document.getElementById('account-pseudo-edit-btn')?.addEventListener('click', _showPseudoForm);
    document.getElementById('account-pseudo-save-btn')?.addEventListener('click', _savePseudo);
    document.getElementById('account-pseudo-cancel-btn')?.addEventListener('click', _hidePseudoForm);

    // Modifier avatar — file picker
    document.getElementById('account-avatar-btn')?.addEventListener('click', _showAvatarForm);
    document.getElementById('account-avatar-save-btn')?.addEventListener('click', _saveAvatar);
    document.getElementById('account-avatar-cancel-btn')?.addEventListener('click', _hideAvatarForm);

    // Sélection de fichier (click sur le label ou drop)
    const fileInput = document.getElementById('account-avatar-file-input');
    if (fileInput) {
        fileInput.addEventListener('change', () => _onAvatarFileSelected(fileInput.files[0]));
    }

    // Drag & drop sur la zone de preview
    const uploadLabel = document.getElementById('avatar-upload-label');
    if (uploadLabel) {
        uploadLabel.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadLabel.classList.add('drag-over');
        });
        uploadLabel.addEventListener('dragleave', () => uploadLabel.classList.remove('drag-over'));
        uploadLabel.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadLabel.classList.remove('drag-over');
            _onAvatarFileSelected(e.dataTransfer.files[0]);
        });
    }

    // Ajouter ami
    document.getElementById('friend-add-btn')?.addEventListener('click', _sendFriendRequest);
    document.getElementById('friend-pseudo-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') _sendFriendRequest();
    });

    // Groupes
    document.getElementById('group-create-btn')?.addEventListener('click', _createGroup);
    document.getElementById('group-name-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') _createGroup();
    });
    document.getElementById('group-map-view-exit-btn')?.addEventListener('click', _exitGroupMapView);
    document.getElementById('group-picker-close-btn')?.addEventListener('click', _closeGroupPicker);
    document.getElementById('group-picker-backdrop')?.addEventListener('click', _closeGroupPicker);
    document.getElementById('group-picker-create-btn')?.addEventListener('click', _createGroupFromPicker);
    document.getElementById('group-picker-create-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') _createGroupFromPicker();
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.group-member-picker-wrap') && _openMemberPickerGroupId) {
            _openMemberPickerGroupId = null;
            _renderGroups();
        }
    });

    // Accordéons
    _initAccordions();
}

document.addEventListener('DOMContentLoaded', initAccountPanel);

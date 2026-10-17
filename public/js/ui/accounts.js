// The hub uses the existing authenticated session; no second account service or credentials store.
import { html, AvatarFrame, MicroLabel } from './components.js';
import { useStore } from '../store.js';
import { t } from '../../../shared/i18n.js';

/** The hub's top-right chip: avatar initial + name; a click opens 统计数据. */
export function AccountMeChip({ player, onStats }) {
  const name = player?.name || t('博士');
  return html`<button type="button" class="me-chip me-chip--btn stats-entry" onClick=${onStats} title=${t('统计数据')} aria-label=${t('统计数据')}>
    <${AvatarFrame} size="sm" name=${name} seat=${0} self=${true} />
    <span class="me-chip__text"><span class="me-chip__name">${name}</span><${MicroLabel}>STATS<//></span>
  </button>`;
}

/** Only the signed-in player's own account metadata is available to the browser. */
export function useAccount(playerId) {
  return useStore((s) => playerId != null && s.me.playerId === playerId ? s.me.account : null);
}

export function AccountTag({ playerId }) {
  const account = useAccount(playerId);
  return account?.username ? html`<small class="account-tag">${account.username}</small>` : null;
}

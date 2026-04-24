/**
 * ga4.ts
 * Thin wrapper around firebase/analytics logEvent.
 * All tracking calls should go through this module so we
 * have a single place to enable/disable/adjust events.
 */
import { logEvent } from 'firebase/analytics';
import { analyticsPromise } from './firebase';

/**
 * Track a page_view event for a card.
 * GA4 has built-in bot filtering, so these numbers are
 * cleaner than raw Firestore writes.
 */
export async function trackCardView(cardOwnerUid: string, username: string) {
  const analytics = await analyticsPromise;
  if (!analytics) return;
  logEvent(analytics, 'page_view', {
    page_title: username,
    page_location: window.location.href,
    card_owner_uid: cardOwnerUid,
  });
}

/**
 * Track a button / link click on a card.
 */
export async function trackCardClick(cardOwnerUid: string, targetId: string) {
  const analytics = await analyticsPromise;
  if (!analytics) return;
  logEvent(analytics, 'select_content', {
    content_type: 'card_element',
    item_id: targetId,
    card_owner_uid: cardOwnerUid,
  });
}

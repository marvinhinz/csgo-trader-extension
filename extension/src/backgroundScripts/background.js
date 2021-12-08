import { storageKeys } from 'utils/static/storageKeys';
import { updatePrices, updateExchangeRates, getUserCurrencyBestGuess } from 'utils/pricing';
import {
  scrapeSteamAPIkey, goToInternalPage, markModMessagesAsRead,
  validateSteamAPIKey, getAssetIDFromInspectLink, getSteamRepInfo,
} from 'utils/utilsModular';
import {
  getGroupInvites, updateFriendRequest,
  ignoreGroupRequest, removeOldFriendRequestEvents,
} from 'utils/friendRequests';
import { trimFloatCache, extractUsefulFloatInfo, addToFloatCache } from 'utils/floatCaching';
import { getSteamNotificationCount, playNotificationSound, notifyOnDiscord } from 'utils/notifications';
import { updateTrades, removeOldOfferEvents } from 'utils/tradeOffers';

import { getItemMarketLink } from 'utils/simpleUtils';
import { getPlayerSummaries } from 'utils/ISteamUser';
import { getUserCSGOInventory, getOtherInventory } from 'utils/getUserInventory';
import { getTradeOffers } from 'utils/IEconService';

// handles install and update events
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // sets the default options for first run
    // (on install from the webstore/amo or when loaded in developer mode)
    for (const [key, value] of Object.entries(storageKeys)) {
      chrome.storage.local.set({ [key]: value }, () => {});
    }

    // sets extension currency to Steam currency when possible
    // the delay is to wait for exchange rates data to be set
    setTimeout(() => {
      getUserCurrencyBestGuess().then((currency) => {
        chrome.storage.local.get(['exchangeRates'], ({ exchangeRates }) => {
          chrome.storage.local.set({
            currency,
            exchangeRate: exchangeRates[currency],
          });
        });
      });
    }, 20000);

    // tries to set the api key - only works if the user has already generated one before
    scrapeSteamAPIkey();

    chrome.action.setBadgeText({ text: 'I' });
    chrome.notifications.create('installed', {
      type: 'basic',
      iconUrl: '/images/cstlogo128.png',
      title: 'Extension installed!',
      message: 'Go to the options through the extension popup and customize your experience!',
    }, () => {
      playNotificationSound();
    });
  } else if (details.reason === 'update') {
    // sets defaults options for new options that haven't been set yet
    // (for features introduced since the last version)
    // runs when the extension updates or gets reloaded in developer mode
    // it checks whether the setting has ever been set
    // I consider removing older ones since there is no one updating from version that old
    const keys = Object.keys(storageKeys);

    chrome.storage.local.get(keys, (result) => {
      for (const [storageKey, storageValue] of Object.entries(storageKeys)) {
        if (result[storageKey] === undefined) {
          chrome.storage.local.set({ [storageKey]: storageValue }, () => {});
        }
      }
    });

    chrome.action.setBadgeText({ text: 'U' });

    // notifies the user when the extension is updated
    chrome.storage.local.set({ showUpdatedRibbon: true }, () => {});
    chrome.storage.local.get('notifyOnUpdate', (result) => {
      if (result.notifyOnUpdate) {
        const version = chrome.runtime.getManifest().version;
        chrome.permissions.contains({
          permissions: ['tabs'],
        }, (permission) => {
          const message = permission
            ? 'You can check the changelog by clicking here!'
            : 'Check the changelog for the hot new stuff!';

          chrome.notifications.create('updated', {
            type: 'basic',
            iconUrl: '/images/cstlogo128.png',
            title: `Extension updated to ${version}!`,
            message,
          }, () => {
            playNotificationSound();
          });
        });
      }
    });
  }

  // updates the prices and exchange rates
  // retries periodically if it's the first time (on install)
  // and it fails to update prices/exchange rates
  updatePrices();
  updateExchangeRates();
  chrome.alarms.create('getSteamNotificationCount', { periodInMinutes: 1 });
  chrome.alarms.create('retryUpdatePricesAndExchangeRates', { periodInMinutes: 1 });
  chrome.alarms.create('dailyScheduledTasks', { periodInMinutes: 1440 });
});

// redirects to feedback survey on uninstall
chrome.runtime.setUninstallURL('https://docs.google.com/forms/d/e/1FAIpQLSdGzY8TrSjfZZtfoerFdAna1E79Y13afxNKG1yytjZkypKTpg/viewform?usp=sf_link', () => {});

// handles what happens when one of the extension's notification gets clicked
chrome.notifications.onClicked.addListener((notificationID) => {
  chrome.action.setBadgeText({ text: '' });
  chrome.permissions.contains({
    permissions: ['tabs'],
  }, (granted) => {
    if (granted) {
      if (notificationID === 'updated') {
        chrome.tabs.create({
          url: 'https://csgotrader.app/changelog/',
        });
      } else if (notificationID.includes('offer_received_')) {
        const offerID = notificationID.split('offer_received_')[1];
        chrome.tabs.create({
          url: `https://steamcommunity.com/tradeoffer/${offerID}/`,
        });
      } else if (notificationID.includes('new_inventory_items_')) {
        chrome.tabs.create({
          url: 'https://steamcommunity.com/my/inventory/',
        });
      } else if (notificationID.includes('invite_')) {
        const userSteamID = notificationID.split('invite_')[1];
        chrome.tabs.create({
          url: `https://steamcommunity.com/profiles/${userSteamID}/`,
        });
      } else if (notificationID === 'new_comment') {
        chrome.tabs.create({
          url: 'https://steamcommunity.com/my/commentnotifications/',
        });
      } else goToInternalPage('index.html?page=bookmarks');
    }
  });
});

// handles periodic and timed events like bookmarked items becoming tradable
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'retryUpdatePricesAndExchangeRates') {
    chrome.storage.local.get('prices', (result) => {
      if (result.prices === null) updatePrices();
      else chrome.alarms.clear('retryUpdatePricesAndExchangeRates', () => {});
    });
  } else if (alarm.name === 'getSteamNotificationCount') {
    getSteamNotificationCount().then(({
      invites, moderatorMessages, tradeOffers, items, comments,
    }) => {
      chrome.storage.local.get(
        ['friendRequests', 'groupInvites', 'ignoreGroupInvites', 'monitorFriendRequests', 'numberOfNewItems',
          'markModerationMessagesAsRead', 'monitorIncomingOffers', 'activeOffers', 'notifyAboutNewItems',
          'numberOfComments', 'notifyAboutComments'],
        ({
          friendRequests, groupInvites, ignoreGroupInvites, monitorFriendRequests, numberOfNewItems,
          markModerationMessagesAsRead, monitorIncomingOffers, activeOffers, notifyAboutNewItems,
          numberOfComments, notifyAboutComments,
        }) => {
          // friend request monitoring
          const minutesFromLastFriendCheck = ((Date.now()
            - new Date(friendRequests.lastUpdated)) / 1000) / 60;
          const friendAndGroupInviteCount = friendRequests.inviters.length
            + groupInvites.invitedTo.length;

          if (invites !== friendAndGroupInviteCount || minutesFromLastFriendCheck >= 30) {
            if (monitorFriendRequests) updateFriendRequest();
            getGroupInvites().then((inviters) => {
              if (ignoreGroupInvites) {
                inviters.forEach((inviter) => {
                  ignoreGroupRequest(inviter.steamID);
                });
              }
            });
          }

          // moderation messages
          if (markModerationMessagesAsRead && moderatorMessages > 0) markModMessagesAsRead();

          // trade offers monitoring
          const minutesFromLastOfferCheck = ((Date.now()
            - (new Date(activeOffers.lastFullUpdate) * 1000)) / 1000) / 60;

          if (monitorIncomingOffers
            && (tradeOffers !== activeOffers.receivedActiveCount
              || minutesFromLastOfferCheck >= 2)) {
            updateTrades();
          }

          // new items notification
          if (notifyAboutNewItems && items !== numberOfNewItems) {
            const numberOfJustNoticedNewItems = items > numberOfNewItems
              ? items - numberOfNewItems
              : 0;
            if (numberOfJustNoticedNewItems > 0) {
              const title = numberOfJustNoticedNewItems === 1
                ? `${numberOfJustNoticedNewItems} new item!`
                : `${numberOfJustNoticedNewItems} new items!`;
              const message = numberOfJustNoticedNewItems === 1
                ? `You have ${numberOfJustNoticedNewItems} item in your inventory!`
                : `You have ${numberOfJustNoticedNewItems} items in your inventory!`;

              chrome.notifications.create(`new_inventory_items_${Date.now()}`, {
                type: 'basic',
                iconUrl: '/images/cstlogo128.png',
                title,
                message,
              }, () => {
                playNotificationSound();
              });
            }
            chrome.storage.local.set({
              numberOfNewItems: items,
            });
          }

          // comment notification
          if (notifyAboutComments) {
            const newComments = comments - numberOfComments;
            if (newComments > 0) {
              const title = newComments === 1
                ? `${newComments} new comment!`
                : `${newComments} new comments!`;
              const message = newComments === 1
                ? `You have ${newComments} new comment!`
                : `You have ${newComments} new comments!`;
              chrome.notifications.create('new_comment', {
                type: 'basic',
                iconUrl: '/images/cstlogo128.png',
                title,
                message,
              }, () => {
                playNotificationSound();
              });
            }
            chrome.storage.local.set({
              numberOfComments: comments,
            });
          }
        },
      );
    }, (error) => {
      console.log(error);
      if (error === 401 || error === 403) {
        if (error === 401) { // user not logged in
          console.log('User not logged in, suspending notification checks for an hour.');
          chrome.storage.local.get(
            ['notifyAboutBeingLoggedOut', 'notifyAboutBeingLoggedOutOnDiscord'],
            ({ notifyAboutBeingLoggedOut, notifyAboutBeingLoggedOutOnDiscord }) => {
              const title = 'You are not signed in on Steam!';
              const message = 'You set to be notified if the extension detects that you are not logged in.';
              if (notifyAboutBeingLoggedOut) {
                chrome.notifications.create(alarm.name, {
                  type: 'basic',
                  iconUrl: '/images/cstlogo128.png',
                  title,
                  message,
                }, () => {
                  playNotificationSound();
                });
              }

              if (notifyAboutBeingLoggedOutOnDiscord) {
                const embed = {
                  footer: {
                    text: 'CSGO Trader',
                    icon_url: 'https://csgotrader.app/cstlogo48.png',
                  },
                  title,
                  description: message,
                  // #ff8c00 (taken from csgotrader.app text color)
                  color: 16747520,
                  fields: [],
                  timestamp: new Date(Date.now()).toISOString(),
                  type: 'rich',
                };
                notifyOnDiscord(embed);
              }
            },
          );
        } else if (error === 403) { // Steam is temporarily blocking this ip
          console.log('Steam is denying access, suspending notification checks for an hour.');
        }
        chrome.alarms.clear('getSteamNotificationCount', () => {
          const now = new Date();
          now.setHours(now.getHours() + 1);
          chrome.alarms.create('restartNotificationChecks', {
            when: (now).valueOf(),
          });
        });
      }
    });
  } else if (alarm.name === 'restartNotificationChecks') {
    chrome.alarms.create('getSteamNotificationCount', { periodInMinutes: 1 });
  } else if (alarm.name === 'dailyScheduledTasks') {
    trimFloatCache();
    removeOldFriendRequestEvents();
    removeOldOfferEvents();
    chrome.storage.local.get('itemPricing', ({ itemPricing }) => {
      if (itemPricing) updatePrices();
    });
    updateExchangeRates();
  } else {
    // this is when bookmarks notification are handled
    chrome.action.getBadgeText({}, (result) => {
      if (result === '' || result === 'U' || result === 'I') chrome.action.setBadgeText({ text: '1' });
      else chrome.action.setBadgeText({ text: (parseInt(result) + 1).toString() });
    });
    chrome.storage.local.get('bookmarks', (result) => {
      const item = result.bookmarks.find((element) => {
        return element.itemInfo.assetid === alarm.name;
      });

      // check if the bookmark was found, it might have been deleted since the alarm was set
      if (item) {
        if (item.notifType === 'chrome') {
          const iconFullURL = `https://steamcommunity.com/economy/image/${item.itemInfo.iconURL}/128x128`;
          chrome.permissions.contains({ permissions: ['tabs'] }, (permission) => {
            const message = permission
              ? 'Click here to see your bookmarks!'
              : `${item.itemInfo.name} is tradable!`;

            chrome.notifications.create(alarm.name, {
              type: 'basic',
              iconUrl: iconFullURL,
              title: `${item.itemInfo.name} is tradable!`,
              message,
            }, () => {
              playNotificationSound();
            });
          });
        } else if (item.notifType === 'alert') {
          chrome.permissions.contains({ permissions: ['tabs'] }, (permission) => {
            if (permission) {
              goToInternalPage('index.html?page=bookmarks');
              setTimeout(() => {
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                  chrome.tabs.sendMessage(tabs[0].id, {
                    alert: item.itemInfo.name,
                  }, () => {
                  });
                });
              }, 1000);
            }
          });
        }
      }
    });
  }
});

// content scripts can't make cross domain requests because of security
// most of the messaging required is to work around this limitation
// and make the request from background script context
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.inventory !== undefined) {
    getUserCSGOInventory(request.inventory).then(({ items, total }) => {
      sendResponse({ items, total });
    }).catch(() => {
      sendResponse('error');
    });
    return true; // async return to signal that it will return later
  }
  if (request.badgetext !== undefined) {
    chrome.action.setBadgeText({ text: request.badgetext });
    sendResponse({ badgetext: request.badgetext });
  } else if (request.openInternalPage !== undefined) {
    chrome.permissions.contains({ permissions: ['tabs'] }, (result) => {
      if (result) {
        goToInternalPage(request.openInternalPage);
        sendResponse({ openInternalPage: request.openInternalPage });
      } else sendResponse({ openInternalPage: 'no_tabs_api_access' });
    });
    return true;
  } else if (request.setAlarm !== undefined) {
    chrome.alarms.create(request.setAlarm.name, {
      when: new Date(request.setAlarm.when).valueOf(),
    });
    // chrome.alarms.getAll((alarms) => {console.log(alarms)});
    sendResponse({ setAlarm: request.setAlarm });
  } else if (request.apikeytovalidate !== undefined) {
    validateSteamAPIKey(request.apikeytovalidate).then(
      (apiKeyValid) => {
        sendResponse({ valid: apiKeyValid });
      }, (error) => {
        console.log(error);
        sendResponse('error');
      },
    );
    return true; // async return to signal that it will return later
  } else if (request.GetPersonaState !== undefined) {
    getPlayerSummaries([request.GetPersonaState]).then((summaries) => {
      sendResponse({
        personastate: summaries[request.GetPersonaState].personastate,
        apiKeyValid: true,
      });
    }).catch((err) => {
      console.log(err);
      if (err === 'api_key_invalid') {
        sendResponse({ apiKeyValid: false });
      } else sendResponse('error');
    });
    return true; // async return to signal that it will return later
  } else if (request.fetchFloatInfo !== undefined) {
    const inspectLink = request.fetchFloatInfo.inspectLink;
    if (inspectLink !== null) {
      const price = (request.fetchFloatInfo.price !== undefined
        && request.fetchFloatInfo.price !== null)
        ? `&price=${request.fetchFloatInfo.price}`
        : '';
      const assetID = getAssetIDFromInspectLink(inspectLink);
      const getRequest = new Request(`https://api.csgofloat.com/?url=${inspectLink}${price}`);

      fetch(getRequest).then((response) => {
        if (!response.ok) {
          console.log(`Error code: ${response.status} Status: ${response.statusText}`);
          if (response.status === 500) sendResponse(response.status);
          else sendResponse('error');
        } else return response.json();
      }).then((body) => {
        if (body.iteminfo.floatvalue !== undefined) {
          const usefulFloatInfo = extractUsefulFloatInfo(body.iteminfo);
          addToFloatCache(assetID, usefulFloatInfo);
          if (usefulFloatInfo.floatvalue !== 0) sendResponse({ floatInfo: usefulFloatInfo });
          else sendResponse('nofloat');
        } else sendResponse('error');
      }).catch((err) => {
        console.log(err);
        sendResponse('error');
      });
    } else sendResponse('nofloat');
    return true; // async return to signal that it will return later
  } else if (request.getSteamRepInfo !== undefined) {
    getSteamRepInfo(request.getSteamRepInfo).then((steamRepInfo) => {
      sendResponse({ SteamRepInfo: steamRepInfo });
    }).catch(() => {
      sendResponse({ SteamRepInfo: 'error' });
    });
    return true; // async return to signal that it will return later
  } else if (request.getTradeOffers !== undefined) {
    if (request.getTradeOffers === 'historical') {
      getTradeOffers(0, 0, 0, 1, 1).then((response) => {
        sendResponse({ offers: response, apiKeyValid: true });
      }).catch((e) => {
        console.log(e);
        if (e === 'api_key_invalid') sendResponse({ apiKeyValid: false });
        else sendResponse('error');
      });
    } else {
      updateTrades().then(({ offersData, items }) => {
        sendResponse({ offers: offersData, items, apiKeyValid: true });
      }).catch((e) => {
        console.log(e);
        if (e === 'api_key_invalid') sendResponse({ apiKeyValid: false });
        else sendResponse('error');
      });
    }
    return true; // async return to signal that it will return later
  } else if (request.getBuyOrderInfo !== undefined) {
    const getRequest = new Request(
      getItemMarketLink(request.getBuyOrderInfo.appID, request.getBuyOrderInfo.marketHashName),
    );

    fetch(getRequest).then((response) => {
      if (!response.ok) {
        sendResponse('error');
        console.log(`Error code: ${response.status} Status: ${response.statusText}`);
      } else return response.text();
    }).then((body1) => {
      let itemNameId = '';
      try { itemNameId = body1.split('Market_LoadOrderSpread( ')[1].split(' ')[0]; } catch (e) {
        console.log(e);
        console.log(body1);
        sendResponse('error');
      }
      const getRequest2 = new Request(`https://steamcommunity.com/market/itemordershistogram?country=US&language=english&currency=${request.getBuyOrderInfo.currencyID}&item_nameid=${itemNameId}`);
      fetch(getRequest2).then((response) => {
        if (!response.ok) {
          sendResponse('error');
          console.log(`Error code: ${response.status} Status: ${response.statusText}`);
        } else return response.json();
      }).then((body2) => {
        sendResponse({ getBuyOrderInfo: body2 });
      }).catch((err) => {
        console.log(err);
        sendResponse('error');
      });
    }).catch((err) => {
      console.log(err);
      sendResponse('error');
    });

    return true; // async return to signal that it will return later
  } else if (request.updateExchangeRates !== undefined) {
    updateExchangeRates();
    sendResponse('exchange rates updated');
  } else if (request.hasTabsAccess !== undefined) {
    chrome.permissions.contains(
      { permissions: ['tabs'] },
      (result) => {
        sendResponse(result);
      },
    );
    return true; // async return to signal that it will return later
  } else if (request.getOtherInventory !== undefined) { // dota and tf2 for now
    getOtherInventory(
      request.getOtherInventory.appID,
      request.getOtherInventory.steamID,
    ).then(({ items }) => {
      sendResponse({ items });
    }).catch(() => {
      sendResponse('error');
    });
    return true; // async return to signal that it will return later
  } else if (request.closeTab !== undefined) {
    chrome.tabs.remove(sender.tab.id);
    return true; // async return to signal that it will return later
  }
});

chrome.runtime.onConnect.addListener(() => {});

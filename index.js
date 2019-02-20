var gh = (function () {
  'use strict';

  var signin_button;
  var user_info_div;
  var errorDiv;
  var repositoryInput;
  var teamInput;

  var tokenFetcher = (function () {
    // Bitbucket Client ID
    var clientId = 'yWsft8zMcZvbXZ5D9Z';
    var redirectUri = chrome.identity.getRedirectURL('provider_cb');
    var redirectRe = new RegExp(redirectUri + '[#\?](.*)');

    var access_token = null;

    return {
      getToken: function (interactive, callback) {
        // In case we already have an access_token cached, simply return it.
        if (access_token) {
          callback(null, access_token);
          return;
        }

        var options = {
          'interactive': interactive,
          'url': 'https://bitbucket.org/site/oauth2/authorize' +
            '?client_id=' + clientId +
            '&response_type=token' +
            '&redirect_uri=' + encodeURIComponent(redirectUri)
        }
        chrome.identity.launchWebAuthFlow(options, function (redirectUri) {
          console.log('launchWebAuthFlow completed', chrome.runtime.lastError,
            redirectUri);

          if (chrome.runtime.lastError) {
            callback(new Error(chrome.runtime.lastError));
            return;
          }

          // Upon success the response is appended to redirectUri, e.g.
          // https://{app_id}.chromiumapp.org/provider_cb#access_token={value}
          //     &refresh_token={value}
          var matches = redirectUri.match(redirectRe);
          if (matches && matches.length > 1)
            handleProviderResponse(parseRedirectFragment(matches[1]));
          else
            callback(new Error('Invalid redirect URI'));
        });

        function parseRedirectFragment(fragment) {
          var pairs = fragment.split(/&/);
          var values = {};

          pairs.forEach(function (pair) {
            var nameval = pair.split(/=/);
            values[nameval[0]] = nameval[1];
          });

          return values;
        }

        function handleProviderResponse(values) {
          console.log('providerResponse', values);
          if (values.hasOwnProperty('access_token'))
            setAccessToken(values.access_token);
          else
            callback(new Error('Neither access_token nor code avialable.'));
        }

        function setAccessToken(token) {
          access_token = token;
          console.log('Setting access_token: ', access_token);
          callback(null, access_token);
        }
      },

      removeCachedToken: function (token_to_remove) {
        if (access_token == token_to_remove)
          access_token = null;
      }
    }
  })();

  function xhrWithAuth(method, url, interactive, callback) {
    var retry = true;
    var access_token;

    console.log('xhrWithAuth', method, url, interactive);
    getToken();

    function getToken() {
      tokenFetcher.getToken(interactive, function (error, token) {
        console.log('token fetch', error, token);
        if (error) {
          callback(error);
          return;
        }

        access_token = decodeURIComponent(token);
        requestStart();
      });
    }

    function requestStart() {
      var xhr = new XMLHttpRequest();
      xhr.open(method, url);
      xhr.setRequestHeader('Authorization', 'Bearer ' + access_token);
      xhr.onload = requestComplete;
      xhr.send();
    }

    function requestComplete() {
      console.log('requestComplete', this.status, this.response);
      if ((this.status < 200 || this.status >= 300) && retry) {
        retry = false;
        tokenFetcher.removeCachedToken(access_token);
        access_token = null;
        getToken();
      } else {
        callback(null, this.status, this.response);
      }
    }
  }

  function getUserInfo(interactive) {
    xhrWithAuth('GET',
      'https://api.bitbucket.org/2.0/user',
      interactive,
      onUserInfoFetched);
  }

  // Functions updating the User Interface:

  function showElement(element) {
    element.style.display = 'inherit';
    element.disabled = false;
  }

  function hideElement(element) {
    element.style.display = 'none';
  }

  function disableButton(button) {
    button.disabled = true;
  }

  function onUserInfoFetched(error, status, response) {
    if (!error && status == 200) {
      showElement(document.querySelector('#user_info'))
      console.log("Got the following user info: " + response);
      var user_info = JSON.parse(response);
      populateUserInfo(user_info);
      hideElement(signin_button);
    } else {
      console.log('infoFetch failed', error, status);
      showElement(signin_button);
    }
  }

  function populateUserInfo(user_info) {
    var elem = user_info_div;
    elem.innerHTML = `Hello <a href="${user_info.links.html.href}">${user_info.display_name}</a>`
  }

  function interactiveSignIn() {
    disableButton(signin_button);
    tokenFetcher.getToken(true, function (error, access_token) {
      if (error) {
        showElement(signin_button);
      } else {
        getUserInfo(true);
      }
    });
  }

  function teamChanged(event) {
    chrome.storage.sync.set({ "team": event.target.value })
    fetchRepository(true, event)
  }

  function fetchRepository(cached, event) {
    const repository = cached ? event : event.target.value
    chrome.storage.sync.set({ "repository": repository });
    const url = `https://api.bitbucket.org/2.0/repositories/${teamInput.value}/${repository}/pullrequests`

    xhrWithAuth('GET',
      url,
      false,
      onRepositoryFetched);
  }

  function onRepositoryFetched(error, status, response) {
    if (!error && status == 200) {
      hideElement(errorDiv)
      const pullRequestList = document.querySelector('#pull_request_list')
      const result = JSON.parse(response).values

      result.forEach(res => {
        const card = document.createElement('div')
        card.className = 'card'
        const cardBody = document.createElement('div')
        cardBody.className = 'card-body'
        const cardTitle = document.createElement('h5')
        cardTitle.className = 'card-title'
        const cardTitleLink = document.createElement('a')
        cardTitleLink.innerHTML = res.title
        cardTitleLink.setAttribute('title', res.title);
        cardTitleLink.setAttribute('href', res.links.html.href);
        cardTitleLink.setAttribute('target','_blank');

        const cardSubTitleWrapper = document.createElement('div')
        cardSubTitleWrapper.className = 'row'

        const cardSubTitleLeft = document.createElement('div')
        cardSubTitleLeft.className = 'col-md-6'
        const cardSubTitleRight = document.createElement('div')
        cardSubTitleRight.className = 'col-md-6'

        cardSubTitleWrapper.appendChild(cardSubTitleLeft)
        cardSubTitleWrapper.appendChild(cardSubTitleRight)

        const cardSubTitle = document.createElement('h6')
        cardSubTitle.className = 'card-subtitle mb-2 text-muted'
        cardSubTitle.innerHTML = res.author.display_name
        cardSubTitleLeft.appendChild(cardSubTitle)

        const cardSubTitleTwo = document.createElement('h6')
        cardSubTitleTwo.className = 'card-subtitle mb-2 text-muted float-right'
        cardSubTitleTwo.innerHTML = res.source.branch.name
        cardSubTitleRight.appendChild(cardSubTitleTwo)

        card.appendChild(cardBody)
        cardBody.appendChild(cardTitle)
        cardTitle.appendChild(cardTitleLink)
        cardBody.appendChild(cardSubTitleWrapper)
        pullRequestList.appendChild(card)
      })

    } else {
      console.log('infoFetch failed', error, status);
      showElement(errorDiv);
    }
  }

  function delay(callback, ms) {
    var timer = 0;
    return function () {
      var context = this, args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () {
        callback.apply(context, args);
      }, ms || 0);
    };
  }

  return {
    onload: function () {
      signin_button = document.querySelector('#signin');
      signin_button.onclick = interactiveSignIn;
      repositoryInput = document.querySelector('#repository')
      teamInput = document.querySelector('#team')

      errorDiv = document.querySelector('#error')

      user_info_div = document.querySelector('#user_info');

      showElement(signin_button);
      hideElement(user_info_div);
      hideElement(errorDiv)
      getUserInfo(false);
      chrome.storage.sync.get(['repository', 'team'], function (result) {
        repositoryInput.value = result['repository'] || ''
        teamInput.value = result['team'] || ''
        fetchRepository(true, result['repository'])
      });

      repositoryInput.onkeyup = delay((e) => fetchRepository(false, e), 200)
      teamInput.onkeyup = delay((e) => teamChanged(e), 200)
    }
  };
})();


window.onload = gh.onload;

const https = require('https');
const queryString = require('querystring');
const cheerio = require('cheerio');
const readline = require('readline');
const path = require('path');
const fs = require('fs');

let uInput = {
  username: '',
  pw: '',
  obfuscatedPhoneNumber: ''
}

let RequestContextKey = '';
let codeReceipt = '';
let authenticationKey = '';
let SAMLResponse = '';
let csrfToken = '';
let cookies = {};

let getRequest = (requestURL, shouldReturnBody = false) => {
  return new Promise((res, rej) => {
    let result = {
      responseBody: '',
      headers: {},
      url: requestURL
    };
    
    https.get(requestURL, response => {
      console.log(`GET Request: ${requestURL}`);
      console.log(` Status ${response.statusCode}: ${response.statusMessage}`);
      
      if (response.statusCode !== 302 && response.statusCode !== 200) {
        rej(new Error('Bad response.'));
      }

      result.headers = response.headers;
      setCookie(result.headers['set-cookie']);
      
      if (!shouldReturnBody) { res(result); return;}
      else { console.log(' Fetching response body..'); }

      response.on('data', chunk => {
        result.responseBody += chunk;
        console.log(` --Chunk: ${chunk.length}`);
      });

      response.on('end', () => {
        console.log(' ----Complete.');
        res(result);
      });

      response.on('error', err => {
        rej(err);
      });
    });
  });
};

let postRequest = (options, urlEncodedData, shouldReturnBody = false) => {
  return new Promise((res, rej) => {
    let result = {
      responseBody: '',
      headers: {}
    };

    let postRequest = https.request(options, response => {
      console.log(`POST Request: ${options.hostname}${options.path}`);
      console.log(` Status ${response.statusCode}: ${response.statusMessage}`);

      result.headers = response.headers;
      setCookie(result.headers['set-cookie']);

      if (!shouldReturnBody) { res(result); return;}
      else { console.log(' Fetching response body..'); }
      
      response.on('data', chunk => {
        result.responseBody += chunk;
        console.log(` --Chunk: ${chunk.length}`);
      });

      response.on('end', () => {
        if (response.statusCode !== 302 && response.statusCode !== 200) {
          fs.writeFile(path.join(__dirname, 'badResponse.html'), result.responseBody, err => {
            if (err) { console.log(err); }
          });
          rej(new Error('Bad response.'));
        }
        
        console.log(' ----Complete.');
        res(result);
      });

      response.on('error', err => {
        rej(err);
      });
    });

    postRequest.write(urlEncodedData);
    postRequest.end();
  });
};

let getSAMLRedirect = () => {
  console.log('Getting redirect.');

  const url = 'https://hub.amazon.work/login';

  return getRequest(url).then(response => {
    return response.headers.location;
  });
};

let getRequestContextKey = (SAMLUrl) => {
  console.log('\nFetching request context key.');
  return getRequest(SAMLUrl, true).then(response => {
    let $ = cheerio.load(response.responseBody);
    RequestContextKey = $('input[name="RequestContextKey"]').attr().value;

    console.log('\x1b[32m', `Retrieved RequestContextKey: ${RequestContextKey}.`, '\x1b[0m');
  });
};

let inputUserName = () => {
  responseBody = '';

  return new Promise(res => {
    (function loop() {
      let username = '';

      return prompt('\nEnter Username: ')
        .then(inputUserName => {
          username = inputUserName;
          return loadRegisteredUserData(inputUserName)
        })
        .then(hasExistingTokens => {
          return submitUsername(username);
        })
        .then(responseBody => {
          let nextAuthStep = getAuthenticationStep(cheerio.load(responseBody)('form'));

          if (nextAuthStep === 'ENTER_USERNAME') {
            console.log('\x1b[31m', '\nInvalid username!', '\x1b[0m');
            loop();
          } else if (nextAuthStep === '') {
            throw new Error('Could not verify username!');
          } else {
            uInput.username = username;

            if (nextAuthStep === 'ENTER_PASSWORD') {
              setAuthenticationKey(responseBody);
              res({step: nextAuthStep});
            } else {
              res({step: nextAuthStep, form: responseBody})
            }
          }
        });
    })();
  });
};

let submitUsername = username => {
  console.log(`\nAttempting to POST username: ${username}.`);

  const data = queryString.stringify({
    login: username,
    RequestContextKey: RequestContextKey,
    AuthenticationStep: 'ENTER_USERNAME'
  });

  let options = {
    hostname: 'idp.amazon.work',
    path: '/idp/login',
    method: 'POST',
    headers: {
      'Content-Length': data.length,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': buildCookieString(cookies)
    }
  };

  return postRequest(options, data, true).then(response => {
    return response.responseBody;
  });
};

let selectPhone = phoneSelectFormHTML => {
  return new Promise((res, rej) => {
    let obfuscatedPhoneNumbers;

    try {
      let $ = cheerio.load(phoneSelectFormHTML);
      obfuscatedPhoneNumbers = $('#phoneNumberSelectionIndex').children('option').toArray();
    } catch(err) {
      console.error(err);
      rej(new Error('Failed to load phone number list.'));
    }

    // First index is dropdown prompt text ('Select your mobile phone number')
    if (obfuscatedPhoneNumbers.length > 2) {
      let phoneNumbers = {};

      for (let i = 1; i < obfuscatedPhoneNumbers.length; ++i) {
        phoneNumbers[obfuscatedPhoneNumbers[i].attribs.value] = obfuscatedPhoneNumbers[i].children[0].data;
      }

      // TODO: Prompt for device selection
    } else {
      uInput.obfuscatedPhoneNumber = obfuscatedPhoneNumbers[1].children[0].data;
      console.log('\x1b[32m', `Selected ${uInput.obfuscatedPhoneNumber} to receive verification code.`, '\x1b[0m');
      res(0);
    }
  });
};

let requestVerificationCode = phoneNumberSelectionIndex => {
  const data = queryString.stringify({
    login: uInput.username,
    RequestContextKey: RequestContextKey,
    AuthenticationStep: 'SELECT_PHONE',
    phoneNumberSelectionIndex: phoneNumberSelectionIndex
  });

  let options = {
    hostname: 'idp.amazon.work',
    path: '/idp/login',
    method: 'POST',
    headers: {
      'Content-Length': data.length,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  };

  return postRequest(options, data, true).then(codeInputForm => {
    console.log(`\nA verification code has been sent to ${uInput.obfuscatedPhoneNumber}.`);
    let $ = cheerio.load(codeInputForm.responseBody);
    codeReceipt = $('#dropDownForm').children('input[name="codeReceipt"]').attr().value;
    console.log('\x1b[32m', `Code Receipt: ${codeReceipt}`, '\x1b[0m');

    return {step: getAuthenticationStep($('#dropDownForm'))};
  });
};

let inputVerificationCode = () => {
  return new Promise(res => {
    (function loop() {
      prompt('\nEnter the verification code: ')
        .then(submitVerificationCode)
        .then(responseBody => {
          let nextAuthStep = getAuthenticationStep(cheerio.load(responseBody)('form'));

          if (nextAuthStep === "ENTER_OTP") {
            console.log('\x1b[31m', '\nInvalid code!', '\x1b[0m');
            loop();
          } else if (nextAuthStep === '') {
            throw new Error('Could not verify code!');
          } else {
            console.log('Successfully submitted code.');
            setAuthenticationKey(responseBody);
            res({step: nextAuthStep, form: responseBody});
          }
        })
    })();
  });
};

let submitVerificationCode = (code) => {
  console.log('\n');
  console.log(`Attempting to POST code: ${code}.`);

  const data = queryString.stringify({
    login: uInput.username,
    RequestContextKey: RequestContextKey,
    AuthenticationStep: 'ENTER_OTP',
    phoneNumberSelectionIndex: 0,
    code: code,
    trustedDevice: 1,
    obfuscatedPhoneNumber: uInput.obfuscatedPhoneNumber,
    codeReceipt: codeReceipt
  });

  let options = {
    hostname: 'idp.amazon.work',
    path: '/idp/login',
    method: 'POST',
    headers: {
      'Content-Length': data.length,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  };

  return postRequest(options, data, true).then(pwForm => {
    return pwForm.responseBody;
  });
};

let inputPassword = () => {
  return new Promise((res) => {
    (function loop() {
      prompt('\nEnter Password: ')
        .then(submitPassword)
        .then(success => {
          if (success) {
            res();
          } else {
            loop();
          }
        })
    })()
  });  
};

let submitPassword = (password) => {
  const data = queryString.stringify({
    login: uInput.username,
    RequestContextKey: RequestContextKey,
    AuthenticationStep: 'ENTER_PASSWORD',
    authenticationKey: authenticationKey,
    password: password
  });

  let options = {
    hostname: 'idp.amazon.work',
    path: '/idp/login?sif_profile=amazon-passport',
    method: 'POST',
    headers: {
      'Content-Length': data.length,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': buildCookieString(cookies)
    }
  };

  return postRequest(options, data, true).then(pwSubmission => {
    try {
      let $ = cheerio.load(pwSubmission.responseBody);
      SAMLResponse = $('input[name="SAMLResponse"]').attr().value;
      console.log('\x1b[32m', 'Got SAMLResponse', '\x1b[0m');
      uInput.pw = password;
      return true;
    } catch (err) {
      console.log('\x1b[31m', '\nInvalid password!', '\x1b[0m');
      return false;
    }
  });
};

let setAuthenticationKey = (pwFormHTML) => {
  fs.writeFile(path.join(__dirname, 'pwform.html'), pwFormHTML, err => {
    if (err) {console.error(err);}
  });
  let $ = cheerio.load(pwFormHTML);
  authenticationKey = $('input[name="authenticationKey"]').attr().value;

  console.log('\x1b[32m', `authenticationKey: ${authenticationKey}`, '\x1b[0m');
};

let getEsspSession = () => {
  console.log('\nAttempting to fetch _essp_session.');
  const data = queryString.stringify({
    SAMLResponse: SAMLResponse
  });

  let options = {
    hostname: 'hub.amazon.work',
    path: '/saml/acs',
    method: 'POST',
    headers: {
      'Content-Length': data.length,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': buildCookieString(cookies)
    }
  };

  return postRequest(options, data, false);
};

let getCSRFToken = () => {
  return new Promise((res, rej) => {
    console.log('\nAttempting to fetch X-CSRF-Token.');

    https.get({
      hostname: 'hub.amazon.work',
      path: '/employees/101146319/schedules',
      headers: {
        Cookie: buildCookieString(cookies)
      }
    }, (response) => {
      let body = '';

      setCookie(response.headers['set-cookie']);
  
      response.on('data', chunk => {
        body += chunk;
      });
  
      response.on('end', () => {
        res(body);
      });
  
      response.on('error', err => {
        rej(err);
      });

    });
  }).then(body => {
    fs.writeFile(path.join(__dirname, 'csrf-token.html'), body, err => {
      if (err) { console.log(err); }
    });
    
    let $ = cheerio.load(body);
    csrfToken = $('meta[name="csrf-token"]').attr().content;
    console.log('\x1b[32m', 'TOKEN:', csrfToken, '\x1b[0m');
  });
};

let prompt = promptMessage => {
  return new Promise((res) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  
    rl.question(promptMessage, userInput => {
      rl.close();
      res(userInput);
    });
  });
}

let setCookie = (cookieArr) => {
  if (!cookieArr) { return; }

  console.log(' set-cookie:');

  for (let i = 0; i < cookieArr.length; ++i) {
    let cookie = cookieArr[i].split(';')[0].split('=');
    cookies[cookie[0]] = cookie[1];
    console.log (` --${cookie[0]}`);
  }
};

let getRegisteredUserTokens = username => {
  return new Promise((res, rej) => {
    fs.readFile(path.join(__dirname, 'users.json'), (err, data) => {
      if (err) { rej(err); return; }

      res(JSON.parse(data));
    });
  }).then(users => {
    if (!username) { return users; }

    if (users[username]) {
      return users[username];
    } else {
      return {};
    }
  }).catch(err => {
    if (err.code === 'ENOENT') {
      return {};
    }
  });
};

let loadRegisteredUserData = (username) => {
  console.log('\nChecking for saved tokens...');
  return getRegisteredUserTokens(username).then(userData => {
    if (Object.keys(userData).length > 0 
    && userData['amzn-idp-auth-key'] 
    && userData['amzn-idp-auth-token']
    && userData['amzn-idp-td-key']
    && userData['amzn-idp-td-token']) {
      console.log('\x1b[32m', 'Found existing tokens.', '\x1b[0m');
      cookies['amzn-idp-auth-key'] = userData['amzn-idp-auth-key'];
      cookies['amzn-idp-auth-token'] = userData['amzn-idp-auth-token'];
      cookies['amzn-idp-td-key'] = userData['amzn-idp-td-key'];
      cookies['amzn-idp-td-token'] = userData['amzn-idp-td-token'];
      return true;
    } else {
      console.log('\x1b[31m', 'No existing tokens.', '\x1b[0m');
      return false;
    }
  });
};

let addNewUser = (newUser) => {
  if (!newUser) { return; }
  
  let idp = {
    'amzn-idp-auth-key': newUser.cookies['amzn-idp-auth-key'],
    'amzn-idp-auth-token': newUser.cookies['amzn-idp-auth-token'],
    'amzn-idp-td-key': newUser.cookies['amzn-idp-td-key'],
    'amzn-idp-td-token': newUser.cookies['amzn-idp-td-token']
  };

  return getRegisteredUserTokens().then(users => {
    users[newUser.username] = idp;
    let stringifiedUsers = JSON.stringify(users);
    return stringifiedUsers;
  }).then(updatedUsersString => {
    return new Promise((res, rej) => {
      fs.writeFile(path.join(__dirname, 'users.json'), updatedUsersString, (err) => {
        if (err) { rej(err); return; }
        console.log(`Successfully saved user: ${newUser.username}`);
        res();
      });
    });
  });
};

module.exports.getAuthKeys = () => {
  return getSAMLRedirect()
    .then(getRequestContextKey)
    .then(loginPrompt)

    .then(getEsspSession)
    .then(getCSRFToken)
    .then(() => {
      let user = {};
      user.username = username;
      user.cookies = cookies;
      return addNewUser(user);
    })
    .then(() => {
      console.log('\nAuthentication complete.\n');

      return {
        cookies: cookies,
        'X-CSRF-TOKEN': csrfToken
      };
    })
    .catch(console.error);
};

let getAuthenticationStep = cheerioForm => {
  let step = '';
  
  try {
    step = cheerioForm.children('input[name="AuthenticationStep"]').attr().value;
  } catch(err) {
    console.error('Failed to get authentication step!');
    console.log(err);
  }

  return step;
}

let loginPrompt = (nextStep) => {
  nextStep = nextStep || 'ENTER_USERNAME';
  let entryStep = {step: nextStep};

  return new Promise(res => {
    (function loop(stepData) {
      let step = stepData.step;

      if (step === 'ENTER_USERNAME') {
        inputUserName()
          .then(loop);
      } else if (step === 'SELECT_PHONE') {
        selectPhone(stepData.form)
          .then(requestVerificationCode)
          .then(loop);
      } else if (step === 'ENTER_OTP') {
        inputVerificationCode()
          .then(loop);
      } else if (step === 'ENTER_PASSWORD') {
        inputPassword()
          .then(res);
      } else {
        let err = new Error('Login Prompt could not determine login step!');
        err.step = step;
        throw err;
      }
    })(entryStep);
  });
};

let buildCookieString = (authData) => {
  let authKeyString = '';
  for (let key in authData) {
    authKeyString += `${key}=${authData[key]}; `;
  }

  return authKeyString;
};

module.exports.buildCookieString = buildCookieString;

let CLI = () => {
  console.log('CLI Login.');

  return getSAMLRedirect()
    .then(getRequestContextKey)
    .then(loginPrompt)
    .then(getEsspSession)
    .then(getCSRFToken)
    .then(() => {
      let user = {};
      user.username = uInput.username;
      user.cookies = cookies;
      return addNewUser(user);
    })
    .then(() => {
      console.log('\nAuthentication complete.\n');

      return {
        user: uInput.username,
        pw: uInput.pw,
        cookies: cookies,
        'X-CSRF-TOKEN': csrfToken
      };
    });
};

module.exports.CLI = CLI;

let reauthenticate = (username, password) => {
  console.log(`Attempting to reauthenticate ${username}.`);
  console.log(uInput);

  loadRegisteredUserData(username);

  return getSAMLRedirect()
    .then(RequestContextKey)
    .then(() => {
      return submitUsername(username);
    })
    .then(() => {
      return submitPassword(password);
    })
    .then(getEsspSession)
    .then(getCSRFToken)
    .then(() => {
      console.log('\nAuthentication complete.\n');

      return {
        user: uInput.username,
        pw: uInput.pw,
        cookies: cookies,
        'X-CSRF-TOKEN': csrfToken
      };
    });
}

module.exports.reauthenticate = reauthenticate;
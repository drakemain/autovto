const https = require('https');
const queryString = require('querystring');
const cheerio = require('cheerio');
const readline = require('readline');
const path = require('path');
const fs = require('fs');

let RequestContextKey = '';
// let login = '';
let login = 'drakmain';
let pw = 'Neednewjob0123';
let obfuscatedPhoneNumber = '';
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
      console.log(` Status: ${response.statusCode}`);
      
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
      console.log(`Status: ${response.statusCode}`);

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
  console.log('\n');
  return getRequest(SAMLUrl, true).then(response => {
    let $ = cheerio.load(response.responseBody);
    RequestContextKey = $('input[name="RequestContextKey"]').attr().value;

    console.log('\x1b[32m', `Retrieved RequestContextKey: ${RequestContextKey}.`, '\x1b[0m');
  });
};

let inputUserName = () => {
  console.log('\n');
  return new Promise((res) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  
    rl.question('Enter username: ', username => {
      rl.close();
      login = username;
      res(username);
    });
  });
};

let getRegisteredUserData = (username) => {
  console.log('\nChecking for saved tokens...');
  return getRegisteredUsers().then(users => {
    if (users[username] && users[username]['amzn-idp-auth-key'] 
    && users[username]['amzn-idp-auth-token']
    && users[username]['amzn-idp-td-key']
    && users[username]['amzn-idp-td-token']) {
      console.log('\x1b[32m', 'Found existing tokens.', '\x1b[0m');
      cookies['amzn-idp-auth-key'] = users[username]['amzn-idp-auth-key'];
      cookies['amzn-idp-auth-token'] = users[username]['amzn-idp-auth-token'];
      cookies['amzn-idp-td-key'] = users[username]['amzn-idp-td-key'];
      cookies['amzn-idp-td-token'] = users[username]['amzn-idp-td-token'];
      return true;
    } else {
      console.log('\x1b[31m', 'No existing tokens.', '\x1b[0m');
      return false;
    }
  });
};

let submitUsername = () => {
  console.log('\n');
  console.log(`Attempting to POST login id: ${login}.`);

  const data = queryString.stringify({
    login: login,
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
  console.log('\n');
  let $ = cheerio.load(phoneSelectFormHTML);
  let obfuscatedPhoneNumbers = $('#phoneNumberSelectionIndex').children('option').toArray();

  if (obfuscatedPhoneNumbers.length > 2) {
    let phoneNumbers = {};

    for (let i = 1; i < obfuscatedPhoneNumbers.length; ++i) {
      phoneNumbers[obfuscatedPhoneNumbers[i].attribs.value] = obfuscatedPhoneNumbers[i].children[0].data;
    }

    // TODO: Prompt for device selection
  } else {
    obfuscatedPhoneNumber = obfuscatedPhoneNumbers[1].children[0].data;
    console.log(`Selected ${obfuscatedPhoneNumber} to receive verification code.`);
    return Promise.resolve(0);
  }
};

let requestVerificationCode = phoneNumberSelectionIndex => {
  console.log('\n');
  const data = queryString.stringify({
    login: 'drakmain',
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
    console.log('\n');
    console.log(`A verification code has been sent to ${obfuscatedPhoneNumber}.`);
    let $ = cheerio.load(codeInputForm.responseBody);
    codeReceipt = $('#dropDownForm').children('input[name="codeReceipt"]').attr().value;
    console.log('\x1b[32m', `Code Receipt: ${codeReceipt}`, '\x1b[0m');
  });
};

let inputVerificationCode = () => {
  console.log('\n');
  return new Promise((res) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  
    rl.question('Enter the verification code: ', code => {
      rl.close();
      res(code);
    });
  });  
};

let submitVerificationCode = (code) => {
  console.log('\n');
  console.log(`Attempting to POST code: ${code}.`);

  const data = queryString.stringify({
    login: 'drakmain',
    RequestContextKey: RequestContextKey,
    AuthenticationStep: 'ENTER_OTP',
    phoneNumberSelectionIndex: 0,
    code: code,
    trustedDevice: 1,
    obfuscatedPhoneNumber: obfuscatedPhoneNumber,
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

let setAuthenticationKey = (pwFormHTML) => {
  fs.writeFile(path.join(__dirname, 'pwform.html'), pwFormHTML, err => {
    if (err) {console.error(err);}
  });
  let $ = cheerio.load(pwFormHTML);
  authenticationKey = $('input[name="authenticationKey"]').attr().value;

  console.log('\x1b[32m', `authenticationKey: ${authenticationKey}`, '\x1b[0m');
};

let inputPassword = () => {
  console.log('\n');
  return new Promise((res) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  
    rl.question('Enter your password: ', password => {
      rl.close();
      res(password);
    });
  });  
};

let submitPassword = (password) => {
  console.log('\n');
  const data = queryString.stringify({
    login: 'drakmain',
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
    let $ = cheerio.load(pwSubmission.responseBody);
    SAMLResponse = $('input[name="SAMLResponse"]').attr().value;
    console.log('\x1b[32m', 'Got SAMLResponse', '\x1b[0m');
  });
};

let getEsspSession = () => {
  console.log('\n');
  console.log('Attempting to fetch _essp_session.');
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
  console.log('\n');
  
  return new Promise((res, rej) => {
    console.log('Attempting to fetch X-CSRF-Token.');

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

let buildCookieString = (authData) => {
  let authKeyString = '';
  for (let key in authData) {
    authKeyString += `${key}=${authData[key]}; `;
  }

  return authKeyString;
};

let setCookie = (cookieArr) => {
  if (!cookieArr) { return; }

  console.log(' set-cookie:');

  for (let i = 0; i < cookieArr.length; ++i) {
    let cookie = cookieArr[i].split(';')[0].split('=');
    cookies[cookie[0]] = cookie[1];
    console.log (` --${cookie[0]}`);
  }
};

let getRegisteredUsers = () => {
  return new Promise((res, rej) => {
    fs.readFile(path.join(__dirname, 'users.json'), (err, data) => {
      if (err) { rej(err); return; }

      res(JSON.parse(data));
    });
  }).catch(err => {
    if (err.code === 'ENOENT') {
      return {};
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

  return getRegisteredUsers().then(users => {
    users[newUser.login] = idp;
    let stringifiedUsers = JSON.stringify(users);
    return stringifiedUsers;
  }).then(updatedUsersString => {
    return new Promise((res, rej) => {
      fs.writeFile(path.join(__dirname, 'users.json'), updatedUsersString, (err) => {
        if (err) { rej(err); return; }
        console.log(`Successfully saved user: ${newUser.login}`);
        res();
      });
    });
  });
};

let loginPrompt = () => {
  // return inputUserName()
  //   .then(getRegisteredUserData)
  //   .then(isRegistered => {
  //     console.log(`Is registered: ${isRegistered}.`);
  //     if (isRegistered) {
  //       return submitUsername()
  //         .then(setAuthenticationKey)
  //         .then(inputPassword)
  //         .then(submitPassword);
  //     } else {
  //       return submitUsername()
  //         .then(selectPhone)
  //         .then(requestVerificationCode)
  //         .then(inputVerificationCode)
  //         .then(submitVerificationCode)
  //         .then(setAuthenticationKey)
  //         .then(inputPassword)
  //         .then(submitPassword);
  //     }
  //   });

  return getRegisteredUserData(login)
    .then(isRegistered => {
      console.log(`Is registered: ${isRegistered}.`);
      if (isRegistered) {
        return submitUsername()
          .then(setAuthenticationKey)
          // .then(inputPassword)
          .then(() => {
            return submitPassword(pw);
          });
      } else {
        return submitUsername()
          .then(selectPhone)
          .then(requestVerificationCode)
          .then(inputVerificationCode)
          .then(submitVerificationCode)
          .then(setAuthenticationKey)
          // .then(inputPassword)
          .then(() => {
            return submitPassword(pw);
          });
      }
    });
};

module.exports.getAuthKeys = () => {
  return getSAMLRedirect()
    .then(getRequestContextKey)

    // .then(inputUserName)
    // .then(submitUsername)
    // .then(selectPhone)
    // .then(requestVerificationCode)
    // .then(inputVerificationCode)
    // .then(submitVerificationCode)
    // .then(inputPassword)
    // .then(submitPassword)
    .then(loginPrompt)

    .then(getEsspSession)
    .then(getCSRFToken)
    .then(() => {
      let user = {};
      user.login = login;
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

module.exports.buildCookieString = buildCookieString;
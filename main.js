const axios = require("axios");
const fs = require("fs");
const path = require("path");
const colors = require("colors");
const readline = require("readline");
const { DateTime } = require("luxon");
const { Mutex } = require("async-mutex");
const {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} = require("worker_threads");
const fakeUserAgent = require("fake-useragent");
const log = require("loglevel");
const prefix = require("loglevel-plugin-prefix");

const consoleMutex = new Mutex();

prefix.reg(log);
prefix.apply(log, {
  format(level, name, timestamp) {
    return `${timestamp} [${level}]`;
  },
});

colors.setTheme({
  debug: "cyan",
  info: "blue",
  warn: "yellow",
  error: "red",
});

const LOG_LEVELS = {
  DEBUG: "debug",
  INFO: "info",
  SUCCESS: "info",
  WARNING: "warn",
  ERROR: "error",
};

class GameBot {
  constructor(threadNumber) {
    this.threadNumber = threadNumber;
    this.queryId = null;
    this.token = null;
    this.userInfo = null;
    this.currentGameId = null;
    this.username = null;
    this.userAgent = this.getRandomUserAgent();
    this.excludedTasksFile = path.join(__dirname, "excludedTasks.json");
    this.logger = log.getLogger(`Thread-${threadNumber}`);
    this.logger.setLevel("trace");
    this.excludedTasks = this.loadExcludedTasks();
  }

  getRandomUserAgent() {
    return fakeUserAgent();
  }

  loadExcludedTasks() {
    if (fs.existsSync(this.excludedTasksFile)) {
      const data = fs.readFileSync(this.excludedTasksFile, "utf8");
      return JSON.parse(data);
    }
    return [];
  }

  async randomDelay() {
    const delay = Math.floor(Math.random() * (5000 - 3000 + 1)) + 3000;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  async log(msg, level = "INFO", additionalInfo = "") {
    const logLevel = LOG_LEVELS[level] || LOG_LEVELS.INFO;
    let coloredLevel;
    switch (level) {
      case "SUCCESS":
        coloredLevel = level.green;
        break;
      case "ERROR":
        coloredLevel = level.red;
        break;
      case "WARNING":
        coloredLevel = level.yellow;
        break;
      case "DEBUG":
        coloredLevel = level.cyan;
        break;
      default:
        coloredLevel = level.blue;
    }

    const timestamp = new Date().toLocaleTimeString();
    const usernameDisplay = this.username
      ? this.username.padEnd(12)
      : "".padEnd(12);
    const logMessage = `${timestamp} | ${coloredLevel.padEnd(
      7
    )} | ${this.threadNumber
      .toString()
      .padStart(2, "0")} | ${usernameDisplay} | ${msg} ${additionalInfo}`;

    await consoleMutex.runExclusive(() => {
      this.logger[logLevel](logMessage);
    });

    await this.randomDelay();
  }

  headers(token = null) {
    const headers = {
      Accept: "application/json, text/plain, */*",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "en-US,en;q=0.6",
      "Content-Type": "application/json",
      Origin: "https://major.glados.app/reward",
      Referer: "https://major.glados.app/",
      "Sec-Ch-Ua":
        '"Not/A)Brand";v="99", "Google Chrome";v="115", "Chromium";v="115"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": this.userAgent,
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
  }

  async getNewToken() {
    const url =
      "https://user-domain.blum.codes/api/v1/auth/provider/PROVIDER_TELEGRAM_MINI_APP";
    const data = JSON.stringify({ query: this.queryId, referralToken: "" });

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.randomDelay();
        const response = await axios.post(url, data, {
          headers: await this.headers(),
        });
        if (response.status === 200) {
          this.token = response.data.token.refresh;
          await this.log("Login successful", "SUCCESS");
          return this.token;
        } else {
          await this.log(JSON.stringify(response.data), "WARNING");
          await this.log(
            `Failed to get token, retrying attempt ${attempt}`,
            "WARNING"
          );
        }
      } catch (error) {
        if (error.response && error.response.status) {
          await this.log(
            `Failed to get token, retrying attempt ${attempt}: Request failed with status ${error.response.status}`,
            "ERROR"
          );
        } else {
          await this.log(
            `Failed to get token, retrying attempt ${attempt}: ${error.message}`,
            "ERROR"
          );
        }
        await this.log(error.toString(), "DEBUG");
      }
    }
    await this.log("Failed to get token after 3 attempts.", "ERROR");
    return null;
  }

  async getUserInfo() {
    try {
      await this.randomDelay();
      const response = await axios.get(
        "https://user-domain.blum.codes/api/v1/user/me",
        { headers: await this.headers(this.token) }
      );
      if (response.status === 200) {
        this.userInfo = response.data;
        this.username = this.userInfo.username;
        return this.userInfo;
      } else {
        const result = response.data;
        if (result.message === "Token is invalid") {
          await this.log("Invalid token, getting new token...", "WARNING");
          const newToken = await this.getNewToken();
          if (newToken) {
            await this.log("Got new token, retrying...", "INFO");
            return this.getUserInfo();
          } else {
            await this.log("Failed to get new token.", "ERROR");
            return null;
          }
        } else {
          await this.log("Unable to get user info", "ERROR");
          return null;
        }
      }
    } catch (error) {
      await this.log(`Unable to get user info: ${error.message}`, "ERROR");
      return null;
    }
  }

  async getBalance() {
    try {
      await this.randomDelay();
      const response = await axios.get(
        "https://game-domain.blum.codes/api/v1/user/balance",
        { headers: await this.headers(this.token) }
      );
      return response.data;
    } catch (error) {
      await this.log(`Unable to get balance info: ${error.message}`, "ERROR");
      return null;
    }
  }

  async getTasks() {
    try {
      await this.randomDelay();
      const response = await axios.get(
        "https://earn-domain.blum.codes/api/v1/tasks",
        { headers: await this.headers(this.token) }
      );
      if (response.status === 200) {
        return response.data;
      } else {
        await this.log("Unable to get task list", "ERROR");
        return [];
      }
    } catch (error) {
      await this.log(`Unable to get task list: ${error.message}`, "ERROR");
      return [];
    }
  }

  async postValidateTask(gameId, keyAnswer) {
    const urlStart = `https://earn-domain.blum.codes/api/v1/tasks/${gameId}/start`;
    const urlValidate = `https://earn-domain.blum.codes/api/v1/tasks/${gameId}/validate`;
    const data = { keyword: `${keyAnswer}` };

    try {
      await this.randomDelay();
      const startResponse = await axios.post(
        urlStart,
        {},
        { headers: await this.headers(this.token) }
      );

      if (startResponse.status === 200) {
        try {
          await this.randomDelay();
          const validateResponse = await axios.post(urlValidate, data, {
            headers: await this.headers(this.token),
          });
          if(validateResponse.status == 200) {
            await this.log(`Success Task ${gameId} and answer ${keyAnswer}`,"SUCCESS");
          }
          return validateResponse.data;
        } catch (error) {
          return null;
        }
      } else {
        try {
          await this.randomDelay();
          const validateResponse = await axios.post(urlValidate, data, {
            headers: await this.headers(this.token),
          });
          if(validateResponse.status == 200) {
            await this.log(`Success Task ${gameId} and answer ${keyAnswer}`,"SUCCESS");
          }
          return validateResponse.data;
        } catch (validateError) {
          return null;
        }
      }
    } catch (error) {
      try {
        await this.randomDelay();
        const validateResponse = await axios.post(urlValidate, data, {
          headers: await this.headers(this.token),
        });
        if(validateResponse.status == 200) {
          await this.log(`Success Task ${gameId} and answer ${keyAnswer}`,"SUCCESS");
        }
        return validateResponse.data;
      } catch (validateError) {
        return null;
      }
    }
  }

  async taskNoAnswer(gameId) {
    const urlStart = `https://earn-domain.blum.codes/api/v1/tasks/${gameId}/start`;
    try {
      await this.randomDelay();
      const validateClaim = await axios.post(
        urlStart,
        {},
        { headers: await this.headers(this.token) }
      );
      await this.log(`Success Task ${gameId}`, "SUCCESS");
      return validateClaim.data;
    } catch (error) {
      const errorMessage = `Unable to validate task: ${error.message}`;
      await this.log(errorMessage, "ERROR");
      if (error.response) {
        await this.log(
          `Validate response error: ${JSON.stringify(error.response.data)}`,
          "ERROR"
        );
      }
      return null;
    }
  }

  async claimTaskAll(gameId) {
    const urlClaim = `https://earn-domain.blum.codes/api/v1/tasks/${gameId}/claim`;
    try {
      await this.randomDelay();
      const validateClaim = await axios.post(
        urlClaim,
        {},
        { headers: await this.headers(this.token) }
      );
      if(validateClaim.status == 200) {
        await this.log(`Success Task ${gameId} claim`, "SUCCESS");
      }
      return validateClaim.data;
    } catch (error) {
      const errorMessage = `Unable to validate task: ${error.message}`;
      await this.log(errorMessage, "ERROR");
      if (error.response) {
        await this.log(
          `Validate response error: ${JSON.stringify(error.response.data)}`,
          "ERROR"
        );
      }
      return null;
    }
  }

  
  async getConfigTaskAnswer() {
    const answerKeyword = `https://raw.githubusercontent.com/bimakhr/blum-answer/refs/heads/main/answer.json`
    try {
      await this.randomDelay();
      const getResponse = await axios.get(answerKeyword);
      if (getResponse.status === 200) {
        const data = getResponse.data;
        if (Array.isArray(data)) {
          return data;
        } else {
          return [];
        }
      } else {
        return [];
      }
    } catch(error) {
      return [];
    }
  }
  
  async startTask(taskId) {
    try {
      await this.randomDelay();
      const response = await axios.post(
        `https://game-domain.blum.codes/api/v1/tasks/${taskId}/start`,
        {},
        { headers: await this.headers(this.token) }
      );
      return response.data;
    } catch (error) {
      return null;
    }
  }

  async claimTask(taskId) {
    try {
      await this.randomDelay();
      const response = await axios.post(
        `https://game-domain.blum.codes/api/v1/tasks/${taskId}/claim`,
        {},
        { headers: await this.headers(this.token) }
      );
      return response.data;
    } catch (error) {
      return null;
    }
  }

  async playGame() {
    const data = JSON.stringify({ game: "example_game" });
    try {
      await this.randomDelay();
      const response = await axios.post(
        "https://game-domain.blum.codes/api/v2/game/play",
        data,
        { headers: await this.headers(this.token) }
      );
      if (response.status === 200) {
        this.currentGameId = response.data.gameId;
        return response.data;
      } else {
        await this.log("Unable to play game", "ERROR");
        return null;
      }
    } catch (error) {
      await this.log(`Unable to play game: ${error.message}`, "ERROR");
      return null;
    }
  }

  async claimGame(points) {
    if (!this.currentGameId) {
      await this.log("No current gameId to claim.", "WARNING");
      return null;
    }

    const data = JSON.stringify({ gameId: this.currentGameId, points: points });
    try {
      await this.randomDelay();
      const response = await axios.post(
        "https://game-domain.blum.codes/api/v1/game/claim",
        data,
        { headers: await this.headers(this.token) }
      );
      return response.data;
    } catch (error) {
      await this.log(`Unable to claim game reward: ${error.message}`, "ERROR");
      await this.log(error.toString(), "DEBUG");
      return null;
    }
  }

  async claimBalance() {
    try {
      await this.randomDelay();
      const response = await axios.post(
        "https://game-domain.blum.codes/api/v1/farming/claim",
        {},
        { headers: await this.headers(this.token) }
      );
      return response.data;
    } catch (error) {
      await this.log(`Unable to claim balance: ${error.message}`, "ERROR");
      return null;
    }
  }

  async startFarming() {
    const data = JSON.stringify({ action: "start_farming" });
    try {
      await this.randomDelay();
      const response = await axios.post(
        "https://game-domain.blum.codes/api/v1/farming/start",
        data,
        { headers: await this.headers(this.token) }
      );
      return response.data;
    } catch (error) {
      await this.log(`Unable to start farming: ${error.message}`, "ERROR");
      return null;
    }
  }

  async checkBalanceFriend() {
    try {
      await this.randomDelay();
      const response = await axios.get(
        `https://user-domain.blum.codes/api/v1/friends/balance`,
        { headers: await this.headers(this.token) }
      );
      return response.data;
    } catch (error) {
      await this.log(
        `Unable to check friend balance: ${error.message}`,
        "ERROR"
      );
      return null;
    }
  }

  async claimBalanceFriend() {
    try {
      await this.randomDelay();
      const response = await axios.post(
        `https://user-domain.blum.codes/api/v1/friends/claim`,
        {},
        { headers: await this.headers(this.token) }
      );
      return response.data;
    } catch (error) {
      await this.log(`Unable to claim friend balance`, "ERROR");
      return null;
    }
  }

  async checkDailyReward() {
    try {
      await this.randomDelay();
      const response = await axios.post(
        "https://game-domain.blum.codes/api/v1/daily-reward?offset=-420",
        {},
        { headers: await this.headers(this.token) }
      );
      return response.data;
    } catch (error) {
      await this.log(
        `You have already checked in or unable to check in daily`,
        "ERROR"
      );
      return null;
    }
  }

  async Countdown(seconds) {
    for (let i = Math.floor(seconds); i >= 0; i--) {
      await consoleMutex.runExclusive(() => {
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(`Waiting ${i} seconds to continue...`);
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    await consoleMutex.runExclusive(() => {
      readline.cursorTo(process.stdout, 0);
      readline.clearLine(process.stdout, 0);
    });
  }

  async taskValidate(gameId, keyword) {
    const url = `https://earn-domain.blum.codes/api/v1/tasks/${gameId}/validate`;
    const payload = { keyword };
    try {
      await this.randomDelay();
      const response = await axios.post(url, payload, {
        headers: await this.headers(this.token),
      });
      if (response.status === 200) {
        await this.log("done vaidate", `SUCCESS ${gameId}`);
        return true;
      }
    } catch (error) {
      return false;
    }
  }

  async joinTribe(tribeId) {
    const url = `https:///tribe-domain.blum.codes/api/v1/tribe/${tribeId}/join`;
    try {
      await this.randomDelay();
      const response = await axios.post(
        url,
        {},
        { headers: await this.headers(this.token) }
      );
      if (response.status === 200) {
        await this.log("You have successfully joined the tribe", "SUCCESS");
        return true;
      }
    } catch (error) {
      if (
        error.response &&
        error.response.data &&
        error.response.data.message === "USER_ALREADY_IN_TRIBE"
      ) {
        await this.log("You have already joined a tribe", "INFO");
      } else {
        await this.log(`Unable to join tribe: ${error.message}`, "ERROR");
      }
      return false;
    }
  }

  formatNextClaimTime(farming) {
    if (!farming) return "N/A";
    const endTime = DateTime.fromMillis(farming.endTime);
    return endTime.toFormat("dd/MM/yyyy HH:mm:ss");
  }

  async processAccount(queryId) {
    this.queryId = queryId;
    let isCompleted = false;

    const token = await this.getNewToken();
    if (!token) {
      await this.log("Unable to get token, skipping this account", "ERROR");
      return null;
    }

    const userInfo = await this.getUserInfo();
    if (userInfo === null) {
      await this.log("Unable to get user info, skipping this account", "ERROR");
      return null;
    }

    const balanceInfo = await this.getBalance();
    if (balanceInfo) {
      await this.log(
        `${balanceInfo.availableBalance}`,
        "SUCCESS",
        `|Next farming ${this.formatNextClaimTime(balanceInfo.farming)}`
      );

      const tribeId = "6f953956-30d8-48dc-a968-e8a2e562c900";
      await this.joinTribe(tribeId);

      if (!balanceInfo.farming) {
        const farmingResult = await this.startFarming();
        if (farmingResult) {
          await this.log("Successfully started farming", "SUCCESS");
        }
      } else {
        const endTime = DateTime.fromMillis(balanceInfo.farming.endTime);
        const currentTime = DateTime.now();
        if (currentTime > endTime) {
          const claimBalanceResult = await this.claimBalance();
          if (claimBalanceResult) {
            await this.log("Successfully claimed farm", "SUCCESS");
          }

          const farmingResult = await this.startFarming();
          if (farmingResult) {
            await this.log("Successfully started farming", "SUCCESS");
          }
        } else {
          const timeLeft = endTime.diff(currentTime).toFormat("hh:mm:ss");
          await this.log(`Next farming ${timeLeft}`, "INFO");
        }
      }
    } else {
      await this.log("Unable to get balance info", "ERROR");
    }

    // Always perform tasks without asking
    const taskListResponse = await this.getTasks();
    if (Array.isArray(taskListResponse) && taskListResponse.length > 0) {
      const configTask = await this.getConfigTaskAnswer();
      if (Array.isArray(configTask) && configTask.length > 0) {
        for (const taskAns of configTask) {
          const startResult = await this.postValidateTask(taskAns.id, taskAns.answer);
          if (startResult) {
            await this.log("startResult", "INFO");
            await this.claimTaskAll(taskAns.id);
          }
        }
      } else {
        await this.log("No tasks to process or data is not an array", "WARNING");
      }
      let allTasks = taskListResponse.flatMap((section) => section.tasks || []);

      allTasks = allTasks.filter(
        (task) => !this.excludedTasks.includes(task.id)
      );

      for (const task of allTasks) {
        if (task.status === "NOT_STARTED") {
            const startResult = await this.startTask(task.id);
          if (startResult) {
            const claimResult = await this.claimTask(task.id);
            if (claimResult && claimResult.status === "FINISHED") {
              await this.log(`Completed task ${task.title}`, "SUCCESS");
            } else {
              await this.log(`Failed to claim task: ${task.title}`, "WARNING");
            }
          }
        }
      }
    } else {
      await this.log(
        "Unable to get task list or task list is empty",
        "WARNING"
   

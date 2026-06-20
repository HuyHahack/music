const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, getVoiceConnection } = require('@discordjs/voice');
const { Riffy } = require('riffy');
const play = require('play-dl');
const express = require('express');
const exec = require('util').promisify(require('child_process').exec);
require('dotenv/config');

// ============ EXPRESS SERVER (Bảo đảm Render scan cổng thành công) ============
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

// Bộ nhóm đệm quản lý các trình phát nhạc cục bộ (Local Player) bằng thư viện @discordjs/voice
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
      .setDescription(`**Tác phẩm:** \`${track.info.title}\`\n**Yêu cầu bởi:** <@${player.requesterId}>`)
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

    // Nhận diện liên kết để phân phối luồng phát phù hợp
    const isUrl = query.startsWith('http://') || query.startsWith('https://');
    const isYouTube = isUrl && (query.includes('youtube.com') || query.includes('youtu.be'));

    // ---------------- TẦNG 1: PHÁT QUA LAVALINK (Dành cho YouTube / Tìm kiếm từ khóa) ----------------
    if (!isUrl || isYouTube) {
      try {
        // Tắt kết nối thư viện cục bộ cũ nếu có để tránh tranh chấp cổng voice
        const oldLocal = localPlayers.get(message.guild.id);
        if (oldLocal) {
          oldLocal.player.stop();
          oldLocal.connection.destroy();
          localPlayers.delete(message.guild.id);
        }

        const player = client.riffy.createConnection({
          guildId: message.guild.id,
          voiceChannel: voiceChannel.id,
          textChannel: message.channel.id,
          deaf: true
        });

        player.requesterId = message.author.id;

        const resolve = await client.riffy.resolve({ query: query, requester: message.author }).catch(() => null);
        if (!resolve || !resolve.tracks || resolve.tracks.length === 0) {
          player.destroy();
          return message.reply('❌ Không tìm thấy tác phẩm này trên YouTube!');
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
          }
        } 
        else {
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
          }
        }
      } catch (err) {
        console.error(err);
      }
      return;
    }

    // ---------------- TẦNG 2: PHÁT QUA THƯ VIỆN CỤC BỘ (Dành cho SoundCloud, TikTok, FB...) ----------------
    else {
      try {
        // Tắt kết nối Lavalink cũ nếu có để tránh tranh chấp cổng voice
        const oldLavalink = client.riffy.players.get(message.guild.id);
        if (oldLavalink) oldLavalink.destroy();

        let stream = null;
        let inputType = null;
        let title = "Đang phát nhạc";

        if (query.includes('soundcloud.com')) {
          // Bắt lỗi chi tiết và ghi nhận nhật ký (log) cho SoundCloud
          const streamInfo = await play.stream(query).catch((err) => {
            console.error('\n❌ LỖI GIẢI MÃ LIÊN KẾT SOUNDCLOUD:');
            console.error(err);
            console.error('=====================================\n');
            return null;
          });

          if (!streamInfo) return message.reply('❌ Lỗi kết nối luồng phát SoundCloud!');
          stream = streamInfo.stream;
          inputType = streamInfo.type;
          title = "SoundCloud Track";
        } else {
          const directUrl = await getDirectAudioUrl(query);
          if (!directUrl) return message.reply('❌ Không thể trích xuất luồng âm thanh từ liên kết này!');
          stream = directUrl;
          title = `Liên kết ngoài (${new URL(query).hostname})`;
        }

        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: message.guild.id,
          adapterCreator: message.guild.voiceAdapterCreator,
        });

        const localPlayer = createAudioPlayer();
        const resource = typeof stream === 'string' 
          ? createAudioResource(stream)
          : createAudioResource(stream, { inputType });

        localPlayer.play(resource);
        connection.subscribe(localPlayer);

        localPlayers.set(message.guild.id, {
          connection,
          player: localPlayer,
          requesterId: message.author.id,
          title
        });

        localPlayer.on(AudioPlayerStatus.Idle, () => {
          connection.destroy();
          localPlayers.delete(message.guild.id);
        });

        const embed = new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('🎵 Đang phát nhạc')
          .setDescription(`**Tác phẩm:** \`${title}\`\n**Yêu cầu bởi:** <@${message.author.id}>`)
          .setFooter({ text: 'Chỉ người yêu cầu hoặc Admin mới có quyền sử dụng m!leave' })
          .setTimestamp();
        await message.channel.send({ embeds: [embed] }).catch(() => {});

      } catch (err) {
        console.error(err);
        await message.reply(`❌ Lỗi phân tích luồng phát cục bộ: ${err.message}`);
      }
    }
  }

  // ============ LỆNH m!leave ============
  if (command === 'leave' || command === 'stop') {
    const active = getActivePlayer(message.guild.id);
    const rawConnection = getVoiceConnection(message.guild.id);

    if (!active && !rawConnection) {
      return message.reply('❌ Bot hiện tại đang không kết nối phòng thoại!');
    }

    const requesterId = active ? active.requesterId : null;
    const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);

    if (requesterId && message.author.id !== requesterId && !isAdmin) {
      return message.reply(`❌ Chỉ có **người yêu cầu phát nhạc** (<@${requesterId}>) hoặc **Quản trị viên** mới được dừng nhạc!`);
    }

    if (active) {
      if (active.type === 'lavalink') {
        active.player.destroy();
      } else {
        active.player.player.stop();
        active.player.connection.destroy();
        localPlayers.delete(message.guild.id);
      }
    } else if (rawConnection) {
      rawConnection.destroy();
    }

    await message.reply('👋 Đã dừng nhạc và rời khỏi phòng voice theo yêu cầu.');
  }

  // ============ LỆNH m!skip ============
  if (command === 'skip' || command === 's') {
    const active = getActivePlayer(message.guild.id);
    if (!active) return message.reply('❌ Bot hiện tại đang không phát nhạc!');

    const requesterId = active.requesterId;
    const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);

    if (requesterId && message.author.id !== requesterId && !isAdmin) {
      return message.reply(`❌ Chỉ có **người yêu cầu phát nhạc** (<@${requesterId}>) hoặc **Quản trị viên** mới được bỏ qua bài!`);
    }

    if (active.type === 'lavalink') {
      active.player.stop();
      await message.reply('⏭️ Đã bỏ qua bài hát hiện tại.');
    } else {
      active.player.player.stop();
      active.player.connection.destroy();
      localPlayers.delete(message.guild.id);
      await message.reply('⏭️ Đã dừng bài hát hiện tại.');
    }
  }

  // ============ LỆNH m!pause ============
  if (command === 'pause') {
    const active = getActivePlayer(message.guild.id);
    if (!active) return message.reply('❌ Bot hiện tại đang không phát nhạc!');

    if (active.type === 'lavalink') {
      active.player.pause(true);
    } else {
      active.player.player.pause();
    }
    await message.reply('⏸️ Đã tạm dừng phát nhạc.');
  }

  // ============ LỆNH m!resume ============
  if (command === 'resume') {
    const active = getActivePlayer(message.guild.id);
    if (!active) return message.reply('❌ Bot hiện tại đang không phát nhạc!');

    if (active.type === 'lavalink') {
      active.player.pause(false);
    } else {
      active.player.player.unpause();
    }
    await message.reply('▶️ Tiếp tục phát nhạc.');
  }

  // ============ LỆNH m!queue ============
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

const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { Riffy } = require('riffy');
const express = require('express');
const execAsync = require('util').promisify(require('child_process').exec);
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

// Cấu hình cụm máy chủ Lavalink v4 công cộng cho YouTube & SoundCloud (Tự động Load Balancing) [2.2.1]
const nodes = [
  {
    name: "HeavenCloud IN",
    host: "89.106.84.59",
    port: 4000,
    password: "heavencloud.in",
    secure: false
  },
  {
    name: "AjieBlogs EU",
    host: "lava-v4.ajieblogs.eu.org",
    port: 443,
    password: "https://dsc.gg/ajidevserver",
    secure: true
  },
  {
    name: "Serenetia v4",
    host: "lavalinkv4.serenetia.com",
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

// Bộ đếm thời gian chờ tránh spam tất cả các lệnh m! (Cooldown 3 giây)
const globalCooldowns = new Map();

// Khai báo đầy đủ các bộ nhớ đệm quản lý chống spam lệnh và tìm kiếm bài hát
const playCooldowns = new Map();      // Giới hạn thời gian chờ riêng cho lệnh phát nhạc (10 giây)
const tempSearchTracks = new Map();   // Lưu tạm kết quả tìm kiếm (Key: userId)

// Hàm hỗ trợ chuyển đổi mili-giây sang định dạng MM:SS
function formatTime(ms) {
  if (isNaN(ms)) return '00:00';
  const totalSecs = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSecs / 60);
  const seconds = totalSecs % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Hàm hỗ trợ vẽ Thanh tiến trình thời gian thực (Progress Bar)
function createProgressBar(position, duration, size = 15) {
  if (isNaN(position) || isNaN(duration)) return '🔘' + '▬'.repeat(size) + ' [00:00 / 00:00]';
  if (position > duration) position = duration;

  const progress = Math.round((size * position) / duration);
  const emptyProgress = size - progress;

  const progressText = '▬'.repeat(progress);
  const emptyProgressText = '▬'.repeat(emptyProgress);

  const bar = `${progressText}🔘${emptyProgressText}`;
  return `${bar} [${formatTime(position)} / ${formatTime(duration)}]`;
}

// Hàm trích xuất liên kết âm thanh trực tiếp bằng yt-dlp cho các nền tảng ngoài (TikTok, Facebook...)
async function getDirectAudioUrl(url) {
  console.log(`\n[yt-dlp] 🌐 Đang trích xuất Direct URL cho liên kết: ${url}`);
  try {
    const { stdout } = await execAsync(`yt-dlp -f "bestaudio[protocol^=http]/bestaudio" -g "${url}"`);
    const directUrl = stdout.trim().split('\n')[0];
    console.log(`[yt-dlp] ✅ Đã lấy được Direct URL tĩnh thành công.`);
    return directUrl;
  } catch (err) {
    console.error('⚠️ Lỗi trích xuất yt-dlp:', err.message);
    return null;
  }
}

// Hàm giám sát thông minh tự động phát hiện trình phát nhạc đang hoạt động trên Server
function getActivePlayer(guildId) {
  const lavalinkPlayer = client.riffy.players.get(guildId);
  if (lavalinkPlayer) {
    return { type: 'lavalink', player: lavalinkPlayer, requesterId: lavalinkPlayer.requesterId };
  }
  return null;
}

client.once('ready', () => {
  client.riffy.init(client.user.id);
  console.log(`\n🎵 Bot phát nhạc Lai Đám Mây (Hybrid) đã trực tuyến: ${client.user.tag}`);
});

// Sự kiện: Bắt đầu phát bài nhạc mới
client.riffy.on("trackStart", async (player, track) => {
  const channel = client.channels.cache.get(player.textChannel);
  if (channel) {
    const title = track.info.title.startsWith('http') ? 'Liên kết ngoài / SoundCloud' : track.info.title;

    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('🎵 Đang phát nhạc')
      .setDescription(`**Tác phẩm:** \`${title}\`\n**Yêu cầu bởi:** <@${track.info.requester.id}>\n\n${createProgressBar(0, track.info.length)}`)
      .setFooter({ text: 'Chỉ người yêu cầu hoặc Admin mới có quyền sử dụng m!leave' })
      .setTimestamp();

    const msg = await channel.send({ embeds: [embed] }).catch(() => null);

    if (msg) {
      if (player.progressInterval) clearInterval(player.progressInterval);

      // Thiết lập bộ đếm tự động cập nhật lại embed thanh thời gian sau mỗi 10 giây
      player.progressInterval = setInterval(async () => {
        const activePlayer = client.riffy.players.get(player.guildId);
        if (!activePlayer || !activePlayer.playing || !activePlayer.current) {
          clearInterval(player.progressInterval);
          return;
        }

        const updatedEmbed = EmbedBuilder.from(embed)
          .setDescription(`**Tác phẩm:** \`${title}\`\n**Yêu cầu bởi:** <@${track.info.requester.id}>\n\n${createProgressBar(activePlayer.position, track.info.length)}`);

        await msg.edit({ embeds: [updatedEmbed] }).catch(() => {
          clearInterval(player.progressInterval);
        });
      }, 10000);
    }
  }
});

// Sự kiện: Hết danh sách chờ nhạc của Lavalink
client.riffy.on("queueEnd", async (player) => {
  if (player.progressInterval) clearInterval(player.progressInterval);
  const channel = client.channels.cache.get(player.textChannel);
  player.destroy();
  if (channel) {
    channel.send("👋 Danh sách phát đã kết thúc. Bot đã rời phòng thoại.").catch(() => {});
  }
});

// ============ BỔ SUNG CÁC SỰ KIỆN LAVALINK TRỰC QUAN (DEBUG LOGS) [1.3.4, 2.2.1] ============
client.riffy.on("nodeConnect", node => {
  console.log(`[NODE CONNECT] ${node.name}`);
});

client.riffy.on("nodeDisconnect", (node, code, reason) => {
  console.log(`[NODE DISCONNECT] ${node.name}`);
  console.log("Code:", code);
  console.log("Reason:", reason);
});

client.riffy.on("nodeError", (node, error) => {
  console.log(`[NODE ERROR] ${node.name}`);
  console.error(error);
});

client.riffy.on("trackError", (player, track, error) => {
  console.log("[TRACK ERROR]");
  console.error(error);
});

client.riffy.on("playerError", (player, track, error) => {
  console.log("[PLAYER ERROR]");
  console.error(error);
});

// Trích xuất dữ liệu Gateway cập nhật Voice State cho Lavalink
client.on("raw", (d) => {
  if (!["VOICE_STATE_UPDATE", "VOICE_SERVER_UPDATE"].includes(d.t)) return;
  client.riffy.updateVoiceState(d);
});

// ============ XỬ LÝ LỰA CHỌN BÀI HÁT TỪ MENU TÌM KIẾM (SEARCH SELECTOR) ============
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;

  if (interaction.customId === 'search_select') {
    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.user.id;
    const searchData = tempSearchTracks.get(userId);

    if (!searchData) {
      return interaction.editReply({ content: '❌ Phiên tìm kiếm đã hết hạn hoặc bạn không phải là người gọi lệnh này!' });
    }

    const selectedIndex = parseInt(interaction.values[0]);
    const chosenTrack = searchData.tracks[selectedIndex];

    // Khởi tạo/Lấy player Lavalink
    const player = client.riffy.createConnection({
      guildId: interaction.guild.id,
      voiceChannel: searchData.voiceChannelId,
      textChannel: searchData.textChannelId,
      deaf: true
    });

    player.requesterId = userId;
    chosenTrack.info.requester = interaction.user;

    // Thêm vào hàng chờ
    player.queue.add(chosenTrack);

    // Xóa tin nhắn bảng chọn tìm kiếm cho gọn kênh chat
    const channel = await client.channels.fetch(searchData.textChannelId).catch(() => null);
    if (channel) {
      const searchMsg = await channel.messages.fetch(searchData.searchMsgId).catch(() => null);
      if (searchMsg) await searchMsg.delete().catch(() => {});
    }

    // Xóa dữ liệu tạm trong bộ nhớ đệm
    tempSearchTracks.delete(userId);

    // Chờ kết nối phòng thoại sẵn sàng
    let attempts = 0;
    while (!player.connected && attempts < 20) {
      await new Promise(r => setTimeout(r, 500));
      attempts++;
    }

    if (player.connected) {
      if (!player.playing && !player.paused) {
        // Log thông tin trước khi chạy player.play()
        console.log("[TRACK INFO]", chosenTrack.info);
        console.log("[NODE USED]", player.node?.name);

        try {
          await player.play();
          console.log("[PLAY SUCCESS]");
        } catch (err) {
          console.error("[PLAY FAILED]", err);
        }

        await interaction.editReply({ content: '✅ Bắt đầu phát bài hát đã chọn!' });
      } else {
        await interaction.editReply({ content: `✅ Đã thêm vào hàng chờ: \`${chosenTrack.info.title}\`` });
        if (channel) {
          await channel.send(`✅ Đã thêm vào hàng chờ: \`${chosenTrack.info.title}\``).catch(() => {});
        }
      }
    } else {
      player.destroy();
      await interaction.editReply({ content: '❌ Lỗi kết nối tới phòng thoại!' });
    }
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild || !message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // ============ CHỐNG SPAM TOÀN CỤC CHO TẤT CẢ CÁC LỆNH (M! COOLDOWN 3 GIÂY) ============
  const userId = message.author.id;
  const now = Date.now();
  const cooldownAmount = 3000;

  if (globalCooldowns.has(userId)) {
    const expirationTime = globalCooldowns.get(userId) + cooldownAmount;
    if (now < expirationTime) {
      const timeLeft = ((expirationTime - now) / 1000).toFixed(1);
      return message.reply(`⚠️ Bạn đang thao tác quá nhanh! Vui lòng đợi **${timeLeft} giây**.`);
    }
  }
  globalCooldowns.set(userId, now);
  setTimeout(() => globalCooldowns.delete(userId), cooldownAmount);

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

    // Cooldown riêng cho lệnh phát nhạc (10 giây)
    const playCooldownAmount = 10000;
    if (playCooldowns.has(userId)) {
      const expirationTime = playCooldowns.get(userId) + playCooldownAmount;
      if (now < expirationTime) {
        const timeLeft = ((expirationTime - now) / 1000).toFixed(1);
        return message.reply(`⚠️ Bạn đang thao tác tìm kiếm nhạc quá nhanh! Vui lòng đợi **${timeLeft} giây**.`);
      }
    }
    playCooldowns.set(userId, now);
    setTimeout(() => playCooldowns.delete(userId), playCooldownAmount);

    // Kích hoạt hiệu ứng đang gõ chữ kín đáo của Discord
    await message.channel.sendTyping().catch(() => {});

    try {
      let finalQuery = query;

      // Nhận diện liên kết để phân phối luồng phát phù hợp
      const isUrl = query.startsWith('http://') || query.startsWith('https://');
      const isYouTube = isUrl && (query.includes('youtube.com') || query.includes('youtu.be'));
      const isSoundCloud = isUrl && query.includes('soundcloud.com'); // Nhận diện SoundCloud gốc
      const isSpotify = isUrl && query.includes('spotify.com');       // Nhận diện Spotify gốc

      // CHỈ dùng yt-dlp cho các liên kết ngoài thực sự (như TikTok, Facebook...) không được Lavalink hỗ trợ mặc định [5]
      if (isUrl && !isYouTube && !isSoundCloud && !isSpotify) {
        const directUrl = await getDirectAudioUrl(query);
        if (directUrl) {
          finalQuery = directUrl; // Gửi link âm thanh tĩnh này cho Lavalink giải mã từ xa!
        }
      }

      console.log("[LAVALINK QUERY]:", finalQuery);

      // Khởi tạo và liên kết Player Lavalink
      const player = client.riffy.createConnection({
        guildId: message.guild.id,
        voiceChannel: voiceChannel.id,
        textChannel: message.channel.id,
        deaf: true
      });

      // LOG THÔNG TIN NODE ĐANG ĐƯỢC CHỌN [1.3.4, 2.2.1]
      console.log("[NODE]", player.node?.name);

      player.requesterId = message.author.id;

      // PHÂN TÍCH LIÊN KẾT NHẠC (BỎ QUA LỖI BẰNG BẪY CATCH CHI TIẾT) [1.3.4, 2.2.1]
      const resolve = await client.riffy.resolve({
        query: finalQuery,
        requester: message.author
      }).catch(err => {
        console.error("[RESOLVE ERROR]", err); // Log toàn bộ object lỗi khi resolve thất bại
        return null;
      });
      
      // LOG KẾT QUẢ RESOLVE ĐẦY ĐỦ VÀ THÔNG SỐ LOADTYPE [1.3.4, 2.2.1]
      console.log("[RESOLVE]", JSON.stringify(resolve, null, 2));
      console.log("[LOADTYPE]", resolve?.loadType);
      console.log("[TRACK COUNT]", resolve?.tracks?.length);

      if (!resolve || !resolve.tracks || resolve.tracks.length === 0) {
        player.destroy();
        return message.reply('❌ Không tìm thấy bài hát hoặc lỗi kết nối máy chủ giải mã!');
      }

      const { loadType, tracks, playlistInfo } = resolve;

      // ---------------- PHÂN LOẠI A: PLAYLIST DANH SÁCH ----------------
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
          if (!player.playing && !player.paused) {
            // Log thông tin trước khi chạy player.play() cho Playlist [1.3.4, 2.2.1]
            const firstTrack = tracks[0];
            if (firstTrack) {
              console.log("[TRACK INFO]", firstTrack.info);
            }
            console.log("[NODE USED]", player.node?.name);

            try {
              await player.play();
              console.log("[PLAY SUCCESS]");
            } catch (err) {
              console.error("[PLAY FAILED]", err);
            }
          } else {
            return message.reply(`✅ Đã thêm danh sách phát **${playlistInfo.name}** (${tracks.length} bài) vào hàng chờ!`);
          }
        } else {
          player.destroy();
          return message.reply('❌ Kết nối tới phòng thoại thất bại do đường truyền Discord quá tải!');
        }
      } 
      // ---------------- PHÂN LOẠI B: TÌM KIẾM TRÊN YOUTUBE MUSIC ----------------
      else if (loadType === 'search') {
        const topTracks = tracks.slice(0, 5); // Lấy 5 kết quả tốt nhất

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('search_select')
          .setPlaceholder('🛒 | Chọn sản phẩm để mua')
          .addOptions(
            topTracks.map((t, index) => 
              new StringSelectMenuOptionBuilder()
                .setLabel(`${index + 1}. ${t.info.title.slice(0, 80)}`)
                .setDescription(`Tác giả: ${t.info.author.slice(0, 40)} | Thời lượng: ${formatTime(t.info.length)}`)
                .setValue(`${index}`)
            )
          );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const embed = new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('🔍 KẾT QUẢ TÌM KIẾM')
          .setDescription(topTracks.map((t, index) => `**${index + 1}.** \`${t.info.title}\` - *${t.info.author}*`).join('\n'))
          .setFooter({ text: 'Chọn bài hát bên dưới để phát. Bảng chọn tự hủy sau 1 phút.' })
          .setTimestamp();

        const searchMsg = await message.reply({ embeds: [embed], components: [row] });

        tempSearchTracks.set(message.author.id, {
          tracks: topTracks,
          voiceChannelId: voiceChannel.id,
          textChannelId: message.channel.id,
          searchMsgId: searchMsg.id
        });

        setTimeout(() => {
          if (tempSearchTracks.has(message.author.id)) {
            tempSearchTracks.delete(message.author.id);
            searchMsg.delete().catch(() => {});
          }
        }, 60000);
      }
      // ---------------- PHÂN LOẠI C: PHÁT TRỰC TIẾP LINK DUY NHẤT ----------------
      else if (loadType === 'track') {
        const track = tracks.shift();
        track.info.requester = message.author;
        player.queue.add(track);

        let attempts = 0;
        while (!player.connected && attempts < 20) {
          await new Promise(r => setTimeout(r, 500));
          attempts++;
        }

        if (player.connected) {
          if (!player.playing && !player.paused) {
            // Log thông tin trước khi chạy player.play() cho Track đơn lẻ [1.3.4, 2.2.1]
            console.log("[TRACK INFO]", track.info);
            console.log("[NODE USED]", player.node?.name);

            try {
              await player.play();
              console.log("[PLAY SUCCESS]");
            } catch (err) {
              console.error("[PLAY FAILED]", err);
            }
          } else {
            return message.reply(`✅ Đã thêm vào hàng chờ: \`${track.info.title}\``);
          }
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

  // ============ LỆNH m!leave ============
  if (command === 'leave' || command === 'stop') {
    const player = getActivePlayer(message.guild.id);

    if (!player) {
      return message.reply('❌ Bot hiện tại đang không kết nối phòng thoại!');
    }

    const requesterId = player.requesterId;
    const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);

    if (requesterId && message.author.id !== requesterId && !isAdmin) {
      return message.reply(`❌ Chỉ có **người yêu cầu phát nhạc** (<@${requesterId}>) hoặc **Quản trị viên** mới được dừng nhạc!`);
    }

    if (player.player.progressInterval) clearInterval(player.player.progressInterval); // Hủy bộ đếm thời gian dính
    player.player.destroy();
    await message.reply('👋 Đã dừng nhạc và rời khỏi phòng voice theo yêu cầu.');
  }

  // ============ LỆNH m!skip ============
  if (command === 'skip' || command === 's') {
    const player = getActivePlayer(message.guild.id);
    if (!player) return message.reply('❌ Bot hiện tại đang không phát nhạc!');

    const requesterId = player.requesterId;
    const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);

    if (requesterId && message.author.id !== requesterId && !isAdmin) {
      return message.reply(`❌ Chỉ có **người phát nhạc** (<@${requesterId}>) hoặc **Quản trị viên** mới được bỏ qua bài!`);
    }

    player.player.stop();
    await message.reply('⏭️ Đã bỏ qua bài hát hiện tại.');
  }

  // ============ LỆNH m!pause ============
  if (command === 'pause') {
    const player = getActivePlayer(message.guild.id);
    if (!player) return message.reply('❌ Bot hiện tại đang không phát nhạc!');
    player.player.pause(true);
    await message.reply('⏸️ Đã tạm dừng phát nhạc.');
  }

  // ============ LỆNH m!resume ============
  if (command === 'resume') {
    const player = getActivePlayer(message.guild.id);
    if (!player) return message.reply('❌ Bot hiện tại đang không phát nhạc!');
    player.player.pause(false);
    await message.reply('▶️ Tiếp tục phát nhạc.');
  }

  // ============ LỆNH m!queue (Xem danh sách chờ) ============
  if (command === 'queue' || command === 'q') {
    const player = getActivePlayer(message.guild.id);
    if (!player || player.player.queue.length === 0) return message.reply('❌ Danh sách hàng chờ hiện tại đang trống!');

    const queueList = player.player.queue.map((track, index) => `**#${index + 1}** | \`${track.info.title}\``).slice(0, 10).join('\n');
    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('📋 DANH SÁCH CHỜ PHÁT (Tối đa 10 bài)')
      .setDescription(queueList)
      .setTimestamp();
    await message.reply({ embeds: [embed] });
  }

  // ============ LỆNH m!volume ============
  if (command === 'volume' || command === 'vol') {
    const player = getActivePlayer(message.guild.id);
    if (!player) return message.reply('❌ Bot hiện tại đang không phát nhạc!');

    const vol = parseInt(args[0]);
    if (isNaN(vol) || vol < 1 || vol > 100) return message.reply('❌ Âm lượng hợp lệ phải nằm trong khoảng từ 1 đến 100!');

    player.player.setVolume(vol);
    await message.reply(`🔊 Đã thiết lập âm lượng thành: **${vol}%**`);
  }

  // ============ LỆNH m!repeat / m!loop (Chế độ phát lặp lại) ============
  if (command === 'repeat' || command === 'loop') {
    const player = getActivePlayer(message.guild.id);
    if (!player) return message.reply('❌ Bot hiện tại đang không phát nhạc!');

    const currentLoop = player.player.loop;
    let newLoop = "none";
    let statusText = "TẮT";

    if (currentLoop === "none") {
      newLoop = "track";
      statusText = "LẶP LẠI BÀI HÁT ĐANG PHÁT 🔂";
    } else if (currentLoop === "track") {
      newLoop = "queue";
      statusText = "LẶP LẠI TOÀN BỘ HÀNG CHỜ 🔁";
    } else {
      newLoop = "none";
      statusText = "TẮT LẶP LẠI ❌";
    }

    player.player.setLoop(newLoop);
    await message.reply(`✅ Đã thiết lập chế độ lặp nhạc thành: **${statusText}**`);
  }
});

// TRÌNH BẮT LỖI TOÀN CỤC CHỐNG SẬP BOT
process.on('unhandledRejection', (error) => console.error('Unhandled rejection:', error));
process.on('uncaughtException', (error) => console.error('Uncaught exception:', error));

client.login(process.env.DISCORD_TOKEN);

import Fuse from "fuse.js";
const result = [
  {
    kind: "customsearch#result",
    title: "Albatross - Sagar lyrics | Musixmatch",
    htmlTitle: "<b>Albatross</b> - Sagar <b>lyrics</b> | <b>Musixmatch</b>",
    link: "https://www.musixmatch.com/lyrics/Albatross-9/Sagar",
    displayLink: "www.musixmatch.com",
    snippet:
      "Lyrics for Sagar by Albatross. सागर यो निलोमा हराउने गर्छौ परेछ बीचमा ... Bhool. Albatross. 4. Adhar. Albatross. Add lyrics. 5.",
    htmlSnippet:
      "<b>Lyrics</b> for Sagar by <b>Albatross</b>. सागर यो निलोमा हराउने गर्छौ परेछ बीचमा ... <b>Bhool</b>. <b>Albatross</b>. 4. Adhar. <b>Albatross</b>. Add <b>lyrics</b>. 5.",
    formattedUrl: "https://www.musixmatch.com/lyrics/Albatross-9/Sagar",
    htmlFormattedUrl:
      "https://www.<b>musixmatch</b>.com/<b>lyrics</b>/<b>Albatross</b>-9/Sagar",
    pagemap: {
      cse_thumbnail: [
        {
          src: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTKOc67A8RBu4Xlmgp6XuwTzkZ7C6ZunO-I00WzHYXO7ewakLIsguY5b4pJ&s",
          width: "310",
          height: "163",
        },
      ],
      metatags: [
        {
          "og:image":
            "https://s.mxmcdn.net/community-dynamic-images/community/lyrics?options=eyJkZXRhaWxzIjoi4KS44KS+4KSX4KSwIOCkr+CliyDgpKjgpL%2FgpLLgpYvgpK7gpL4g4KS54KSw4KS+4KSJ4KSo4KWHIOCkl+CksOCljeCkm+CljFxu4KSq4KSw4KWH4KSbIOCkrOClgOCkmuCkruCkviwg4KSc4KWB4KSV4KWN4KSk4KWAIOCkieCkruCljeCkleCkqOClhyDgpJXgpYHgpKjgpYgg4KS44KWL4KSaXG7gpKfgpJXgpL7gpLIg4KSv4KWLIOCkp+CksOCljeCkpOClgCwg4KSG4KSV4KS+4KS2IOCkhuCkgeCkluCkvuCksuClhyDgpK3gpY3gpK%2FgpL7gpI%2FgpLjgpK7gpY3gpK5cbuCkheCkneCliCDgpKTgpL7gpKjgpY3gpKbgpYgg4KSy4KSX4KWN4KSv4KWLIOCkheCkqOCkqOCljeCkpOCkleCliyDgpJfgpLngpL%2FgpLDgpL7gpIfgpK7gpL5cbiIsImxvZ28iOiJodHRwczovL3MubXhtY2RuLm5ldC9pbWFnZXMtc3RvcmFnZS9hbGJ1bXMyLzAvOS82LzEvNS82LzQwNjUxNjkwXzUwMF81MDAuanBnIiwibmFtZSI6IkFsYmF0cm9zcyIsInRpdGxlIjoiU2FnYXIifQ%3D%3D&imageFormat=jpeg&signature=1%2FArt3s%2Be4zO5uHZq3SEL8GjH4wCeZwOT7agH3ahKUs&signature_protocol=sha256",
          "apple-itunes-app":
            "app-id=448278467, app-argument=mxm://lyrics/154117788",
          "og:image:width": "500",
          "og:type": "website",
          "twitter:card": "summary",
          "twitter:title": "Albatross - Sagar lyrics | Musixmatch",
          "al:ios:app_name": "musixmatch lyrics player",
          "twitter:url": "https://www.musixmatch.com/lyrics/Albatross-9/Sagar",
          "og:title": "Albatross - Sagar lyrics | Musixmatch",
          "og:image:height": "500",
          "al:android:package": "com.musixmatch.android.lyrify",
          "al:ios:url": "mxm://lyrics/154117788",
          "og:description":
            "Lyrics for Sagar by Albatross. सागर यो निलोमा हराउने गर्छौ\nपरेछ बीचमा, जुक्ती उम्कने कुनै सोच\nधकाल यो धर्ती, आकाश आँखाले ...",
          "twitter:image":
            "https://s.mxmcdn.net/community-dynamic-images/community/lyrics?options=eyJkZXRhaWxzIjoi4KS44KS+4KSX4KSwIOCkr+CliyDgpKjgpL%2FgpLLgpYvgpK7gpL4g4KS54KSw4KS+4KSJ4KSo4KWHIOCkl+CksOCljeCkm+CljFxu4KSq4KSw4KWH4KSbIOCkrOClgOCkmuCkruCkviwg4KSc4KWB4KSV4KWN4KSk4KWAIOCkieCkruCljeCkleCkqOClhyDgpJXgpYHgpKjgpYgg4KS44KWL4KSaXG7gpKfgpJXgpL7gpLIg4KSv4KWLIOCkp+CksOCljeCkpOClgCwg4KSG4KSV4KS+4KS2IOCkhuCkgeCkluCkvuCksuClhyDgpK3gpY3gpK%2FgpL7gpI%2FgpLjgpK7gpY3gpK5cbuCkheCkneCliCDgpKTgpL7gpKjgpY3gpKbgpYgg4KSy4KSX4KWN4KSv4KWLIOCkheCkqOCkqOCljeCkpOCkleCliyDgpJfgpLngpL%2FgpLDgpL7gpIfgpK7gpL5cbiIsImxvZ28iOiJodHRwczovL3MubXhtY2RuLm5ldC9pbWFnZXMtc3RvcmFnZS9hbGJ1bXMyLzAvOS82LzEvNS82LzQwNjUxNjkwXzUwMF81MDAuanBnIiwibmFtZSI6IkFsYmF0cm9zcyIsInRpdGxlIjoiU2FnYXIifQ%3D%3D&imageFormat=jpeg&signature=1%2FArt3s%2Be4zO5uHZq3SEL8GjH4wCeZwOT7agH3ahKUs&signature_protocol=sha256",
          "al:ios:app_store_id": "448278467",
          "al:android:url": "mxm://lyrics/154117788",
          "next-head-count": "35",
          viewport: "width=device-width, initial-scale=1.0",
          "twitter:description":
            "Lyrics for Sagar by Albatross. सागर यो निलोमा हराउने गर्छौ\nपरेछ बीचमा, जुक्ती उम्कने कुनै सोच\nधकाल यो धर्ती, आकाश आँखाले ...",
          "og:url": "https://www.musixmatch.com/lyrics/Albatross-9/Sagar",
          "al:android:app_name": "musixmatch lyrics player",
        },
      ],
      cse_image: [
        {
          src: "https://s.mxmcdn.net/community-dynamic-images/community/lyrics?options=eyJkZXRhaWxzIjoi4KS44KS+4KSX4KSwIOCkr+CliyDgpKjgpL%2FgpLLgpYvgpK7gpL4g4KS54KSw4KS+4KSJ4KSo4KWHIOCkl+CksOCljeCkm+CljFxu4KSq4KSw4KWH4KSbIOCkrOClgOCkmuCkruCkviwg4KSc4KWB4KSV4KWN4KSk4KWAIOCkieCkruCljeCkleCkqOClhyDgpJXgpYHgpKjgpYgg4KS44KWL4KSaXG7gpKfgpJXgpL7gpLIg4KSv4KWLIOCkp+CksOCljeCkpOClgCwg4KSG4KSV4KS+4KS2IOCkhuCkgeCkluCkvuCksuClhyDgpK3gpY3gpK%2FgpL7gpI%2FgpLjgpK7gpY3gpK5cbuCkheCkneCliCDgpKTgpL7gpKjgpY3gpKbgpYgg4KSy4KSX4KWN4KSv4KWLIOCkheCkqOCkqOCljeCkpOCkleCliyDgpJfgpLngpL%2FgpLDgpL7gpIfgpK7gpL5cbiIsImxvZ28iOiJodHRwczovL3MubXhtY2RuLm5ldC9pbWFnZXMtc3RvcmFnZS9hbGJ1bXMyLzAvOS82LzEvNS82LzQwNjUxNjkwXzUwMF81MDAuanBnIiwibmFtZSI6IkFsYmF0cm9zcyIsInRpdGxlIjoiU2FnYXIifQ%3D%3D&imageFormat=jpeg&signature=1%2FArt3s%2Be4zO5uHZq3SEL8GjH4wCeZwOT7agH3ahKUs&signature_protocol=sha256",
        },
      ],
    },
  },
  {
    kind: "customsearch#result",
    title:
      "Shristi ra Dristi - Albatross: Song Lyrics, Music Videos & Concerts",
    htmlTitle:
      "Shristi ra Dristi - <b>Albatross</b>: Song <b>Lyrics</b>, Music Videos &amp; Concerts",
    link: "https://www.shazam.com/track/223787848/shristi-ra-dristi",
    displayLink: "www.shazam.com",
    snippet:
      "Listen to Bhool by Albatross, see lyrics, music video & more! BhoolAlbatross ... Writer(s): Albatross Lyrics powered by www.musixmatch.com. Shazam ...",
    htmlSnippet:
      "Listen to <b>Bhool</b> by <b>Albatross</b>, see <b>lyrics</b>, music video &amp; more! <b>BhoolAlbatross</b> ... Writer(s): <b>Albatross Lyrics</b> powered by www.<b>musixmatch</b>.com. Shazam&nbsp;...",
    formattedUrl: "https://www.shazam.com/track/223787848/shristi-ra-dristi",
    htmlFormattedUrl:
      "https://www.shazam.com/track/223787848/shristi-ra-dristi",
    pagemap: {
      cse_thumbnail: [
        {
          src: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSgVguPBwQfSHY4TFsNiTr312fYeO-PkI4n7NJQyTXEPDCEunhIPlz-vJk&s",
          width: "225",
          height: "225",
        },
      ],
      musicrecording: [
        {
          name: "Albatross",
        },
      ],
      metatags: [
        {
          "apple-itunes-app":
            "app-id=284993459, affiliate-data=partnerId=30&siteID=uuRxNR5XS20&at=11l3eE&ct=5348615A-616D-3235-3830-44754D6D5973, app-argument=shazam://v5/track/1412862325",
          "og:image":
            "https://is1-ssl.mzstatic.com/image/thumb/Music118/v4/a3/bf/ff/a3bfff28-8c2a-35c0-0183-f039f4280dff/cover.jpg/800x800cc.jpg",
          "og:image:width": "400",
          "og:type": "website",
          "twitter:card": "summary_large_image",
          "twitter:title":
            "Shristi ra Dristi - Albatross: Song Lyrics, Music Videos & Concerts",
          "og:site_name": "Shazam",
          "al:ios:app_name": "Shazam",
          "og:title":
            "Shristi ra Dristi - Albatross: Song Lyrics, Music Videos & Concerts",
          "og:image:height": "400",
          "twitter:image:height": "400",
          "al:android:package": "com.shazam.android",
          "al:ios:url": "shazam://song/1412862325",
          "og:description":
            "Listen to Shristi ra Dristi by Albatross. See lyrics and music videos, find Albatross tour dates, buy concert tickets, and more!",
          "twitter:image":
            "https://is1-ssl.mzstatic.com/image/thumb/Music118/v4/a3/bf/ff/a3bfff28-8c2a-35c0-0183-f039f4280dff/cover.jpg/800x800cc.jpg",
          "al:ios:app_store_id": "284993459",
          "al:android:url": "shazam://song/1412862325",
          "twitter:site": "@Shazam",
          "twitter:image:width": "400",
          viewport: "width=device-width, initial-scale=1",
          "twitter:description":
            "Listen to Shristi ra Dristi by Albatross. See lyrics and music videos, find Albatross tour dates, buy concert tickets, and more!",
          "al:android:web_url":
            "https://www.shazam.com/song/1412862325/shristi-ra-dristi",
          "og:url": "https://www.shazam.com/song/1412862325/shristi-ra-dristi",
          "al:android:app_name": "Shazam",
        },
      ],
      cse_image: [
        {
          src: "https://is1-ssl.mzstatic.com/image/thumb/Music118/v4/a3/bf/ff/a3bfff28-8c2a-35c0-0183-f039f4280dff/cover.jpg/800x800cc.jpg",
        },
      ],
      listenaction: [
        {
          description: "Shristi ra Dristi",
        },
      ],
    },
  },
  {
    kind: "customsearch#result",
    title: "Albatross - Gari Khana Deu Lyrics | Musixmatch",
    htmlTitle:
      "<b>Albatross</b> - Gari Khana Deu <b>Lyrics</b> | <b>Musixmatch</b>",
    link: "https://www.musixmatch.com/de/songtext/Albatross-9/Gari-Khana-Deu",
    displayLink: "www.musixmatch.com",
    snippet:
      "Lyrics für Gari Khana Deu von Albatross. verse. मुख मात्र चलाएर केही हुन्न ... Bhool. Albatross. 4. Adhar. Albatross. Songtext hinzufügen. 5.",
    htmlSnippet:
      "<b>Lyrics</b> für Gari Khana Deu von <b>Albatross</b>. verse. मुख मात्र चलाएर केही हुन्न ... <b>Bhool</b>. <b>Albatross</b>. 4. Adhar. <b>Albatross</b>. Songtext hinzufügen. 5.",
    formattedUrl:
      "https://www.musixmatch.com/de/songtext/Albatross-9/Gari-Khana-Deu",
    htmlFormattedUrl:
      "https://www.<b>musixmatch</b>.com/de/songtext/<b>Albatross</b>-9/Gari-Khana-Deu",
    pagemap: {
      cse_thumbnail: [
        {
          src: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQSTWIuKY2TY7TFAFif8PqjA3Al-oR037BpBNfnGPvFjuruU2OdllPUPty8&s",
          width: "310",
          height: "163",
        },
      ],
      metatags: [
        {
          "og:image":
            "https://s.mxmcdn.net/community-dynamic-images/community/lyrics?options=eyJkZXRhaWxzIjoi4KSu4KWB4KSWIOCkruCkvuCkpOCljeCksCDgpJrgpLLgpL7gpI%2FgpLAg4KSV4KWH4KS54KWAIOCkueClgeCkqOCljeCkqCDgpIXgpKxcbuCkreCli+CksuCkvyDgpKzgpLLgpY3gpLIg4KSG4KSJ4KSy4KS+IOCksuCkleCljeCkt+CljeCkryDgpLLgpL%2FgpIgg4KSs4KSi4KWN4KSb4KWM4KSBIOCkheCkmOCkvyDgpJzgpKxcbuCkuOClgeCkqOCljeCkqOCkv+CkuOCkleClhyDgpLngpL7gpKTgpLngpLDgpYIsIOCkpuClgeCkluCkv+CkuOCkleClhyDgpJfgpYvgpKHgpL5cbuCkhuCkq+CljeCkqOCliyDgpLjgpY3gpLXgpL7gpLDgpY3gpKUg4KSq4KWB4KSw4KWN4KSv4KS+4KSJ4KSo4KWHIOCkleCljeCksOCkruCkruCkviDgpKbgpYHgpIjgpJrgpL7gpLAg4KSc4KSo4KS+4KSy4KS+4KSIIOCkruCkv+CkmuCljeCkqOClgSDgpKjgpL8g4KSt4KSv4KWLIOCkueCli+CksuCkvlxu4KSuIOCkleClh+CkteCksiDgpIngpLjgpJXgpYsg4KSy4KS+4KSX4KS%2FIiwibG9nbyI6Imh0dHBzOi8vcy5teG1jZG4ubmV0L2ltYWdlcy1zdG9yYWdlL2FsYnVtczIvMC85LzYvMS81LzYvNDA2NTE2OTBfNTAwXzUwMC5qcGciLCJuYW1lIjoiQWxiYXRyb3NzIiwidGl0bGUiOiJHYXJpIEtoYW5hIERldSJ9&imageFormat=jpeg&signature=MpFKnVG3ARiR7PxjkGJZI2c7ML8hOG8p%2BgQl06ZR5HE&signature_protocol=sha256",
          "apple-itunes-app":
            "app-id=448278467, app-argument=mxm://lyrics/154117780",
          "og:image:width": "500",
          "og:type": "website",
          "twitter:card": "summary",
          "twitter:title": "Albatross - Gari Khana Deu Lyrics | Musixmatch",
          "al:ios:app_name": "musixmatch lyrics player",
          "twitter:url":
            "https://www.musixmatch.com/lyrics/Albatross-9/Gari-Khana-Deu",
          "og:title": "Albatross - Gari Khana Deu Lyrics | Musixmatch",
          "og:image:height": "500",
          "al:android:package": "com.musixmatch.android.lyrify",
          "al:ios:url": "mxm://lyrics/154117780",
          "og:description":
            "Songtext zu Gari Khana Deu von Albatross. मुख मात्र चलाएर केही हुन्न अब\nभोलि बल्ल आउला लक्ष्य लिई बढ्छौँ अघि जब\nसुन्निसके हातहरू, दु...",
          "twitter:image":
            "https://s.mxmcdn.net/community-dynamic-images/community/lyrics?options=eyJkZXRhaWxzIjoi4KSu4KWB4KSWIOCkruCkvuCkpOCljeCksCDgpJrgpLLgpL7gpI%2FgpLAg4KSV4KWH4KS54KWAIOCkueClgeCkqOCljeCkqCDgpIXgpKxcbuCkreCli+CksuCkvyDgpKzgpLLgpY3gpLIg4KSG4KSJ4KSy4KS+IOCksuCkleCljeCkt+CljeCkryDgpLLgpL%2FgpIgg4KSs4KSi4KWN4KSb4KWM4KSBIOCkheCkmOCkvyDgpJzgpKxcbuCkuOClgeCkqOCljeCkqOCkv+CkuOCkleClhyDgpLngpL7gpKTgpLngpLDgpYIsIOCkpuClgeCkluCkv+CkuOCkleClhyDgpJfgpYvgpKHgpL5cbuCkhuCkq+CljeCkqOCliyDgpLjgpY3gpLXgpL7gpLDgpY3gpKUg4KSq4KWB4KSw4KWN4KSv4KS+4KSJ4KSo4KWHIOCkleCljeCksOCkruCkruCkviDgpKbgpYHgpIjgpJrgpL7gpLAg4KSc4KSo4KS+4KSy4KS+4KSIIOCkruCkv+CkmuCljeCkqOClgSDgpKjgpL8g4KSt4KSv4KWLIOCkueCli+CksuCkvlxu4KSuIOCkleClh+CkteCksiDgpIngpLjgpJXgpYsg4KSy4KS+4KSX4KS%2FIiwibG9nbyI6Imh0dHBzOi8vcy5teG1jZG4ubmV0L2ltYWdlcy1zdG9yYWdlL2FsYnVtczIvMC85LzYvMS81LzYvNDA2NTE2OTBfNTAwXzUwMC5qcGciLCJuYW1lIjoiQWxiYXRyb3NzIiwidGl0bGUiOiJHYXJpIEtoYW5hIERldSJ9&imageFormat=jpeg&signature=MpFKnVG3ARiR7PxjkGJZI2c7ML8hOG8p%2BgQl06ZR5HE&signature_protocol=sha256",
          "al:ios:app_store_id": "448278467",
          "al:android:url": "mxm://lyrics/154117780",
          "next-head-count": "35",
          viewport: "width=device-width, initial-scale=1.0",
          "twitter:description":
            "Songtext zu Gari Khana Deu von Albatross. मुख मात्र चलाएर केही हुन्न अब\nभोलि बल्ल आउला लक्ष्य लिई बढ्छौँ अघि जब\nसुन्निसके हातहरू, दु...",
          "og:url":
            "https://www.musixmatch.com/lyrics/Albatross-9/Gari-Khana-Deu",
          "al:android:app_name": "musixmatch lyrics player",
        },
      ],
      cse_image: [
        {
          src: "https://s.mxmcdn.net/community-dynamic-images/community/lyrics?options=eyJkZXRhaWxzIjoi4KSu4KWB4KSWIOCkruCkvuCkpOCljeCksCDgpJrgpLLgpL7gpI%2FgpLAg4KSV4KWH4KS54KWAIOCkueClgeCkqOCljeCkqCDgpIXgpKxcbuCkreCli+CksuCkvyDgpKzgpLLgpY3gpLIg4KSG4KSJ4KSy4KS+IOCksuCkleCljeCkt+CljeCkryDgpLLgpL%2FgpIgg4KSs4KSi4KWN4KSb4KWM4KSBIOCkheCkmOCkvyDgpJzgpKxcbuCkuOClgeCkqOCljeCkqOCkv+CkuOCkleClhyDgpLngpL7gpKTgpLngpLDgpYIsIOCkpuClgeCkluCkv+CkuOCkleClhyDgpJfgpYvgpKHgpL5cbuCkhuCkq+CljeCkqOCliyDgpLjgpY3gpLXgpL7gpLDgpY3gpKUg4KSq4KWB4KSw4KWN4KSv4KS+4KSJ4KSo4KWHIOCkleCljeCksOCkruCkruCkviDgpKbgpYHgpIjgpJrgpL7gpLAg4KSc4KSo4KS+4KSy4KS+4KSIIOCkruCkv+CkmuCljeCkqOClgSDgpKjgpL8g4KSt4KSv4KWLIOCkueCli+CksuCkvlxu4KSuIOCkleClh+CkteCksiDgpIngpLjgpJXgpYsg4KSy4KS+4KSX4KS%2FIiwibG9nbyI6Imh0dHBzOi8vcy5teG1jZG4ubmV0L2ltYWdlcy1zdG9yYWdlL2FsYnVtczIvMC85LzYvMS81LzYvNDA2NTE2OTBfNTAwXzUwMC5qcGciLCJuYW1lIjoiQWxiYXRyb3NzIiwidGl0bGUiOiJHYXJpIEtoYW5hIERldSJ9&imageFormat=jpeg&signature=MpFKnVG3ARiR7PxjkGJZI2c7ML8hOG8p%2BgQl06ZR5HE&signature_protocol=sha256",
        },
      ],
    },
  },
  {
    kind: "customsearch#result",
    title: "Khaseka Tara - Albatross: Song Lyrics, Music Videos & Concerts",
    htmlTitle:
      "Khaseka Tara - <b>Albatross</b>: Song <b>Lyrics</b>, Music Videos &amp; Concerts",
    link: "https://www.shazam.com/track/204752824",
    displayLink: "www.shazam.com",
    snippet:
      "Listen to Bhool by Albatross, see lyrics, music video & more! BhoolAlbatross ... Writer(s): Albatross, Shirish Dali Lyrics powered by www.musixmatch.com ...",
    htmlSnippet:
      "Listen to <b>Bhool</b> by <b>Albatross</b>, see <b>lyrics</b>, music video &amp; more! <b>BhoolAlbatross</b> ... Writer(s): <b>Albatross</b>, Shirish Dali <b>Lyrics</b> powered by www.<b>musixmatch</b>.com&nbsp;...",
    formattedUrl: "https://www.shazam.com/track/204752824",
    htmlFormattedUrl: "https://www.shazam.com/track/204752824",
    pagemap: {
      cse_thumbnail: [
        {
          src: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS26QUHhmfW02xs6QiPP5wSmjM8omaHb8zFfcZVUP7prtvqdPKLfTMYT-E&s",
          width: "225",
          height: "225",
        },
      ],
      musicrecording: [
        {
          name: "Albatross",
        },
      ],
      metatags: [
        {
          "apple-itunes-app":
            "app-id=284993459, affiliate-data=partnerId=30&siteID=uuRxNR5XS20&at=11l3eE&ct=5348615A-616D-3235-3830-44754D6D5973, app-argument=shazam://v5/track/1412804669",
          "og:image":
            "https://is1-ssl.mzstatic.com/image/thumb/Music123/v4/37/c7/2b/37c72ba7-d9a0-b6bb-86eb-75f03d28f9cc/cover.jpg/800x800cc.jpg",
          "og:image:width": "400",
          "og:type": "website",
          "twitter:card": "summary_large_image",
          "twitter:title":
            "Khaseka Tara - Albatross: Song Lyrics, Music Videos & Concerts",
          "og:site_name": "Shazam",
          "al:ios:app_name": "Shazam",
          "og:title":
            "Khaseka Tara - Albatross: Song Lyrics, Music Videos & Concerts",
          "og:image:height": "400",
          "twitter:image:height": "400",
          "al:android:package": "com.shazam.android",
          "al:ios:url": "shazam://song/1412804669",
          "og:description":
            "Listen to Khaseka Tara by Albatross. See lyrics and music videos, find Albatross tour dates, buy concert tickets, and more!",
          "twitter:image":
            "https://is1-ssl.mzstatic.com/image/thumb/Music123/v4/37/c7/2b/37c72ba7-d9a0-b6bb-86eb-75f03d28f9cc/cover.jpg/800x800cc.jpg",
          "al:ios:app_store_id": "284993459",
          "al:android:url": "shazam://song/1412804669",
          "twitter:site": "@Shazam",
          "twitter:image:width": "400",
          viewport: "width=device-width, initial-scale=1",
          "twitter:description":
            "Listen to Khaseka Tara by Albatross. See lyrics and music videos, find Albatross tour dates, buy concert tickets, and more!",
          "al:android:web_url":
            "https://www.shazam.com/song/1412804669/khaseka-tara",
          "og:url": "https://www.shazam.com/song/1412804669/khaseka-tara",
          "al:android:app_name": "Shazam",
        },
      ],
      cse_image: [
        {
          src: "https://is1-ssl.mzstatic.com/image/thumb/Music123/v4/37/c7/2b/37c72ba7-d9a0-b6bb-86eb-75f03d28f9cc/cover.jpg/800x800cc.jpg",
        },
      ],
      listenaction: [
        {
          description: "Khaseka Tara",
        },
      ],
    },
  },
  {
    kind: "customsearch#result",
    title: "Albatross - Gari Khana Deu II lyrics | Musixmatch",
    htmlTitle:
      "<b>Albatross</b> - Gari Khana Deu II <b>lyrics</b> | <b>Musixmatch</b>",
    link: "https://www.musixmatch.com/lyrics/Albatross-9/Gari-Khana-Deu-II",
    displayLink: "www.musixmatch.com",
    snippet:
      'Lyrics for Gari Khana Deu II by Albatross. "जेसुकै गर्" भनी लागेँ म छेउ ढिलो ... Bhool. Albatross. 4. Adhar. Albatross. Add lyrics. 5.',
    htmlSnippet:
      "<b>Lyrics</b> for Gari Khana Deu II by <b>Albatross</b>. &quot;जेसुकै गर्&quot; भनी लागेँ म छेउ ढिलो ... <b>Bhool</b>. <b>Albatross</b>. 4. Adhar. <b>Albatross</b>. Add <b>lyrics</b>. 5.",
    formattedUrl:
      "https://www.musixmatch.com/lyrics/Albatross-9/Gari-Khana-Deu-II",
    htmlFormattedUrl:
      "https://www.<b>musixmatch</b>.com/<b>lyrics</b>/<b>Albatross</b>-9/Gari-Khana-Deu-II",
    pagemap: {
      cse_thumbnail: [
        {
          src: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRd_pSQpFH0CuIQzKWpqACQBkeA98Eq1wuY1GJlkK5UgJumo6eDKoJ_JK_E&s",
          width: "310",
          height: "163",
        },
      ],
      metatags: [
        {
          "og:image":
            "https://s.mxmcdn.net/community-dynamic-images/community/lyrics?options=eyJkZXRhaWxzIjoiXCLgpJzgpYfgpLjgpYHgpJXgpYgg4KSX4KSw4KWNXCIg4KSt4KSo4KWAIOCksuCkvuCkl+Clh+CkgSDgpK4g4KSb4KWH4KSJXG7gpKLgpL%2FgpLLgpYsg4KSt4KSv4KWLIOCkheCkrCDgpK7gpLLgpL7gpIgg4KSX4KSw4KS%2F4KSW4KS+4KSoXG5cblwi4KSc4KWH4KS44KWB4KSV4KWIIOCkl+CksOCljVwiIOCkreCkqOClgCDgpLLgpL7gpJfgpYfgpIEg4KSuIOCkm+Clh+CkiVxu4KSi4KS%2F4KSy4KWLIOCkreCkr+Cliywg4KSF4KSsIOCkruCksuCkvuCkiCDgpJfgpLDgpL%2FgpJbgpL7gpKgg4KSm4KWH4KSKIiwibG9nbyI6Imh0dHBzOi8vcy5teG1jZG4ubmV0L2ltYWdlcy1zdG9yYWdlL2FsYnVtczIvMC85LzYvMS81LzYvNDA2NTE2OTBfNTAwXzUwMC5qcGciLCJuYW1lIjoiQWxiYXRyb3NzIiwidGl0bGUiOiJHYXJpIEtoYW5hIERldSBJSSJ9&imageFormat=jpeg&signature=m17JVXegMNWL1Un6DktckJh4xPqU6%2FQ%2FRDSqYlrPyso&signature_protocol=sha256",
          "apple-itunes-app":
            "app-id=448278467, app-argument=mxm://lyrics/154117786",
          "og:image:width": "500",
          "og:type": "website",
          "twitter:card": "summary",
          "twitter:title": "Albatross - Gari Khana Deu II lyrics | Musixmatch",
          "al:ios:app_name": "musixmatch lyrics player",
          "twitter:url":
            "https://www.musixmatch.com/lyrics/Albatross-9/Gari-Khana-Deu-II",
          "og:title": "Albatross - Gari Khana Deu II lyrics | Musixmatch",
          "og:image:height": "500",
          "al:android:package": "com.musixmatch.android.lyrify",
          "al:ios:url": "mxm://lyrics/154117786",
          "og:description":
            'Lyrics for Gari Khana Deu II by Albatross. "जेसुकै गर्" भनी लागेँ म छेउ\nढिलो भयो अब मलाई गरिखान\n\n"जेसुकै गर्" भनी लागेँ म छेउ\nढिलो भय...',
          "twitter:image":
            "https://s.mxmcdn.net/community-dynamic-images/community/lyrics?options=eyJkZXRhaWxzIjoiXCLgpJzgpYfgpLjgpYHgpJXgpYgg4KSX4KSw4KWNXCIg4KSt4KSo4KWAIOCksuCkvuCkl+Clh+CkgSDgpK4g4KSb4KWH4KSJXG7gpKLgpL%2FgpLLgpYsg4KSt4KSv4KWLIOCkheCkrCDgpK7gpLLgpL7gpIgg4KSX4KSw4KS%2F4KSW4KS+4KSoXG5cblwi4KSc4KWH4KS44KWB4KSV4KWIIOCkl+CksOCljVwiIOCkreCkqOClgCDgpLLgpL7gpJfgpYfgpIEg4KSuIOCkm+Clh+CkiVxu4KSi4KS%2F4KSy4KWLIOCkreCkr+Cliywg4KSF4KSsIOCkruCksuCkvuCkiCDgpJfgpLDgpL%2FgpJbgpL7gpKgg4KSm4KWH4KSKIiwibG9nbyI6Imh0dHBzOi8vcy5teG1jZG4ubmV0L2ltYWdlcy1zdG9yYWdlL2FsYnVtczIvMC85LzYvMS81LzYvNDA2NTE2OTBfNTAwXzUwMC5qcGciLCJuYW1lIjoiQWxiYXRyb3NzIiwidGl0bGUiOiJHYXJpIEtoYW5hIERldSBJSSJ9&imageFormat=jpeg&signature=m17JVXegMNWL1Un6DktckJh4xPqU6%2FQ%2FRDSqYlrPyso&signature_protocol=sha256",
          "al:ios:app_store_id": "448278467",
          "al:android:url": "mxm://lyrics/154117786",
          "next-head-count": "34",
          viewport: "width=device-width, initial-scale=1.0",
          "twitter:description":
            'Lyrics for Gari Khana Deu II by Albatross. "जेसुकै गर्" भनी लागेँ म छेउ\nढिलो भयो अब मलाई गरिखान\n\n"जेसुकै गर्" भनी लागेँ म छेउ\nढिलो भय...',
          "og:url":
            "https://www.musixmatch.com/lyrics/Albatross-9/Gari-Khana-Deu-II",
          "al:android:app_name": "musixmatch lyrics player",
        },
      ],
      cse_image: [
        {
          src: "https://s.mxmcdn.net/community-dynamic-images/community/lyrics?options=eyJkZXRhaWxzIjoiXCLgpJzgpYfgpLjgpYHgpJXgpYgg4KSX4KSw4KWNXCIg4KSt4KSo4KWAIOCksuCkvuCkl+Clh+CkgSDgpK4g4KSb4KWH4KSJXG7gpKLgpL%2FgpLLgpYsg4KSt4KSv4KWLIOCkheCkrCDgpK7gpLLgpL7gpIgg4KSX4KSw4KS%2F4KSW4KS+4KSoXG5cblwi4KSc4KWH4KS44KWB4KSV4KWIIOCkl+CksOCljVwiIOCkreCkqOClgCDgpLLgpL7gpJfgpYfgpIEg4KSuIOCkm+Clh+CkiVxu4KSi4KS%2F4KSy4KWLIOCkreCkr+Cliywg4KSF4KSsIOCkruCksuCkvuCkiCDgpJfgpLDgpL%2FgpJbgpL7gpKgg4KSm4KWH4KSKIiwibG9nbyI6Imh0dHBzOi8vcy5teG1jZG4ubmV0L2ltYWdlcy1zdG9yYWdlL2FsYnVtczIvMC85LzYvMS81LzYvNDA2NTE2OTBfNTAwXzUwMC5qcGciLCJuYW1lIjoiQWxiYXRyb3NzIiwidGl0bGUiOiJHYXJpIEtoYW5hIERldSBJSSJ9&imageFormat=jpeg&signature=m17JVXegMNWL1Un6DktckJh4xPqU6%2FQ%2FRDSqYlrPyso&signature_protocol=sha256",
        },
      ],
    },
  },
  {
    kind: "customsearch#result",
    title:
      "Legitimization in Phishing: A CDA Perspective Learning English as ...",
    htmlTitle:
      "Legitimization in Phishing: A CDA Perspective Learning English as ...",
    link: "https://www.ewubd.edu/storage/app/uploads/public/5e5/4b0/8e8/5e54b08e8def5826098942.pdf",
    displayLink: "www.ewubd.edu",
    snippet:
      "Albatross Publications, Dhaka. Print. Page 36. East West ... 337) through the lyrics (both for the item songs and the romantic songs) is never addressed.",
    htmlSnippet:
      "<b>Albatross</b> Publications, Dhaka. Print. Page 36. East West ... 337) through the <b>lyrics</b> (both for the item songs and the romantic songs) is never addressed.",
    formattedUrl:
      "https://www.ewubd.edu/storage/app/.../5e54b08e8def5826098942.pdf",
    htmlFormattedUrl:
      "https://www.ewubd.edu/storage/app/.../5e54b08e8def5826098942.pdf",
    pagemap: {
      cse_thumbnail: [
        {
          src: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQOtrN9X2HEfPF1nvF8pEAkf-zWz2hvXpn4nvUkK1mZRCtbm2FlBoY6P70&s",
          width: "231",
          height: "218",
        },
      ],
      metatags: [
        {
          moddate: "D:20190610124429+06'00'",
          producer: "www.ilovepdf.com",
        },
      ],
      cse_image: [
        {
          src: "x-raw-image:///a4453fd13d9d1caf5f2f6a4b66779a41323609c7327317603c8560cac3713bb6",
        },
      ],
    },
    mime: "application/pdf",
    fileFormat: "PDF/Adobe Acrobat",
  },
];

const options = {
  keys: ["title"], // The property to search in each item
  threshold: 0.4, // How fuzzy the matching is (0 = exact, 1 = very loose)
  includeScore: true, // Shows how well each result matches,
  isCaseSensitive: false, // Whether the search is case sensitive
  ignoreLocation: true, // Ignore the location of the search term
};

const fuse = new Fuse(result, options);

console.log(fuse.search("bhool albatross")[0]);

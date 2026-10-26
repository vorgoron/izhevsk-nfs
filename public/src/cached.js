// Адрес большого файла (city.json, модели) с версией: `?v=` + ETag (хеш содержимого у Firebase) или
// Last-Modified из HEAD-запроса мимо кеша. Firebase Hosting на условный запрос не отвечает 304, и с no-cache
// каждый заход качал бы ~4 МБ заново; этим файлам в firebase.json — кеш на год, а свежесть даёт версия.
// HEAD не удался — версия из времени: скачать заново дешевле, чем застрять на годовом кеше старого файла.
export async function cachedURL(url) {
  let v = '';
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (res.ok) v = res.headers.get('etag') || res.headers.get('last-modified') || '';
  } catch {}
  return `${url}?v=${encodeURIComponent(v.replace(/^W\/|"/g, '') || Date.now())}`;
}

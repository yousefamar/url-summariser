const express = require('express');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const fetch = require('node-fetch');
const { YoutubeTranscript } = require('youtube-transcript');

const app = express();
const port = process.env.PORT || 8080;

const OPENAI_API_KEY = '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';

const youtubeRegex = /^.*(?:(?:youtu\.be\/|v\/|vi\/|u\/\w\/|embed\/)|(?:(?:watch)?\?v(?:i)?=|\&v(?:i)?=))([^#\&\?]*).*/im;

async function fetchWebpage(url) {
  const res = await fetch(url, {
    redirect: 'follow',
  });
  const html = await res.text();
  let doc = new JSDOM(html);

  // If the link is a hackernews link, we need to get the actual link
  if (url.startsWith('https://news.ycombinator.com/item?id=')) {
    const linkElement = doc.window.document.querySelector('.titleline > a');
    console.log('HN link detected, instead summarising', linkElement?.href);
    if (linkElement?.href) {
      const res = await fetch(linkElement.href, {
        redirect: 'follow',
      });
      const html = await res.text();
      doc = new JSDOM(html);
    }
  }

  const reader = new Readability(doc.window.document);
  const article = reader.parse();

  if (!article)
    return null;

  return `# ${article.title}\n\n${article.textContent}`;
}

async function summarise(inputText, summaryWords = 100) {

  // 3000 words (approx) is equivalent to the 4097 token limit for gpt-3.5-turbo
  // If the input is longer than this, we split it in half and recurse

  const words = inputText.split(' ');
  if (words.length > 3000) {
    const half = Math.floor(words.length / 2);
    const firstHalf = words.slice(0, half).join(' ');
    const secondHalf = words.slice(half).join(' ');
    const results = await Promise.all([
      summarise(firstHalf, summaryWords),
      summarise(secondHalf, summaryWords)
    ]);
    return summarise(results.join(' '), summaryWords);
  }

  while (true) {
    const payload = {
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: `You are a summarizer. When given text, you produce an accurate summary no longer than ${summaryWords} word${summaryWords > 1 ? 's' : ''} long. You respond only with the summary and no other commentary whatsoever.` },
        { role: "user", content: inputText },
      ]
    };

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const res = await response.json();
    
    if (res.error) {
      console.log(res);
      console.log('Retrying...');
      continue;
    }

    console.log(res);

    return res.choices[0]?.message.content;
  }
}

app.get('/favicon.ico', (req, res) => res.status(204));

app.get('*', async (req, res) => {
  const url = req.originalUrl.substring(1);

  if (!url)
    return res.status(400).send('No URL provided');

  if (!url.startsWith('http://') && !url.startsWith('https://'))
    return res.status(400).send('URL must be absolute');

  console.log('Summarising:', url);

  let inputText;
  if (youtubeRegex.test(url)) {
    inputText = await YoutubeTranscript.fetchTranscript(url, { lang: 'en' });
    inputText = inputText.map(({ text }) => text).join('\n');
    // return res.send(inputText);
  } else {
    inputText = await fetchWebpage(url);
  }

  if (!inputText)
    return res.status(400).send('Could not fetch webpage');

  const summary = await summarise(inputText);

  return res.send(summary);
})

app.listen(port, () => {
  console.log(`URL Summariser started on port ${port}`);
});
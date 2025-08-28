import { aesEcbEncrypt, base64 } from "../../utils/crypto";
import { getPref, setPref } from "../../utils/prefs";
import { TranslateTaskProcessor } from "../../utils/translate";

export default <TranslateTaskProcessor>async function (data) {
  let progressWindow;
  const useSplit = getPref("cnkiUseSplit") as boolean;
  const splitSecond = getPref("cnkiSplitSecond") as number;
  const maxlength = getPref("cnkiMaxLength") as number;

  // if (!data.silent) {
  //   progressWindow = new ztoolkit.ProgressWindow("PDF Translate");
  // }

  const processTranslation = async (text: string) => {
    const xhr = await Zotero.HTTP.request(
      "POST",
      "https://dict.cnki.net/fyzs-front-api/translate/literaltranslation",
      {
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          Token: await getToken(),
        },
        body: JSON.stringify({
          words: await getWord(text),
          translateType: null,
        }),
        responseType: "json",
      }
    );

    if (xhr.response.data?.isInputVerificationCode) {
      throw "Your access is temporarily banned by the CNKI service. Please goto https://dict.cnki.net/, translate manually and pass human verification.";
    }

    let tgt = xhr.response.data?.mResult || "";
    // 去广告
    tgt = tgt.replace(
      "(查看名企职位领高薪offer！--->智联招聘https://dict.cnki.net/ad.html)",
      ""
    );
    // 正则清理
    const regex = getPref("cnkiRegex") as string;
    if (regex) {
      tgt = tgt.replace(new RegExp(regex, "g"), "");
    }
    return tgt;
  };

  if (useSplit) {
    // 按标点拆句，避免超过 maxlength 字符
    const sentences = data.raw
      .split(/[.?!]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const chunks: string[] = [];
    let currentChunk = "";
    sentences.forEach((sentence: string) => {
      const sentenceWithPeriod = sentence + ". ";
      if (currentChunk.length + sentenceWithPeriod.length > maxlength) {
        chunks.push(currentChunk);
        currentChunk = sentenceWithPeriod;
      } else {
        currentChunk += sentenceWithPeriod;
      }
    });
    if (currentChunk) {
      chunks.push(currentChunk);
    }

    let translatedText = "";
    for (const chunk of chunks) {
      translatedText += (await processTranslation(chunk)) + " ";
      data.result = translatedText.trim();
      // 动态刷新 UI
      addon.hooks.onReaderTabPanelRefresh();
      await new Promise((resolve) =>
        Zotero.setTimeout(resolve, splitSecond * maxlength)
      );
    }
  } else {
    // 不分句：直接处理
    if (data.raw.length > maxlength) {
      new ztoolkit.ProgressWindow("PDF Translate")
        .createLine({
          text: `Maximam text length is 1000, ${data.raw.length} selected. Will only translate first 1000 characters.`,
        })
        .show();
      data.raw = data.raw.slice(0, maxlength);
    }
    data.result = await processTranslation(data.raw);
  }
};

async function getToken(forceRefresh: boolean = false) {
  let token = "";
  let doRefresh = true;
  try {
    const tokenObj = JSON.parse(getPref("cnkiToken") as string);
    if (
      !forceRefresh &&
      tokenObj?.token &&
      new Date().getTime() - tokenObj.t < 300 * 1000
    ) {
      token = tokenObj.token;
      doRefresh = false;
    }
  } catch (e) { }
  if (doRefresh) {
    const xhr = await Zotero.HTTP.request(
      "GET",
      "https://dict.cnki.net/fyzs-front-api/getToken",
      { responseType: "json" }
    );
    if (xhr && xhr.response && xhr.response.code === 200) {
      token = xhr.response.data; // ✅ 统一用 data
      setPref(
        "cnkiToken",
        JSON.stringify({
          t: new Date().getTime(),
          token: xhr.response.data,
        })
      );
    }
  }
  return token;
}

async function getWord(text: string) {
  const encrypted = await aesEcbEncrypt(text, "4e87183cfd3a45fe");
  const base64str = base64(encrypted.buffer);
  return base64str.replace(/\//g, "_").replace(/\+/g, "-");
}

/**
 * partials/head-title.hbs（ページタイトルとシェア用タイトルのメタタグ）のテスト。
 *
 * Ghost 本体のヘルパー群は使えないため、素の Handlebars でパーシャルを描画し、
 * パーシャルが利用する Ghost ヘルパー `meta_title` と `t` をスタブとして登録する。
 * `@site` は Handlebars の data 変数として渡す。
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Handlebars from 'handlebars';

const パーシャル = readFileSync(new URL('../partials/head-title.hbs', import.meta.url), 'utf8');

/**
 * パーシャルを描画する。
 *
 * @param {object} 引数
 * @param {object|undefined} 引数.post - ルートコンテキストの post（記事・固定ページ以外では undefined）
 * @param {string} 引数.metaTitle - 記事以外のページで Ghost の meta_title ヘルパーが返す値
 * @returns {string} 描画結果
 */
function 描画({post, metaTitle = 'はなしのタネ'}) {
    const hbs = Handlebars.create();
    hbs.registerHelper('meta_title', () => metaTitle);
    hbs.registerHelper('t', text => text);
    const template = hbs.compile(パーシャル);
    return template({post}, {data: {site: {title: 'はなしのタネ'}}});
}

test('記事ページでは「記事タイトル - サイト名」を title、og:title、twitter:title に出力する', () => {
    const html = 描画({post: {title: 'immutableなノートを堆積する'}});
    assert.ok(html.includes('<title>immutableなノートを堆積する - はなしのタネ</title>'), html);
    assert.ok(html.includes('<meta property="og:title" content="immutableなノートを堆積する - はなしのタネ">'), html);
    assert.ok(html.includes('<meta name="twitter:title" content="immutableなノートを堆積する - はなしのタネ">'), html);
});

test('記事にメタタイトルが設定されていればそちらを優先する', () => {
    const html = 描画({post: {title: 'immutableなノートを堆積する', meta_title: 'ノートの堆積について'}});
    assert.ok(html.includes('<title>ノートの堆積について - はなしのタネ</title>'), html);
    assert.ok(html.includes('<meta property="og:title" content="ノートの堆積について - はなしのタネ">'), html);
    assert.ok(!html.includes('immutableなノートを堆積する'), html);
});

test('タイトルに含まれる HTML 特殊文字はエスケープする', () => {
    const html = 描画({post: {title: 'A & B <C>'}});
    assert.ok(html.includes('<title>A &amp; B &lt;C&gt; - はなしのタネ</title>'), html);
    assert.ok(html.includes('content="A &amp; B &lt;C&gt; - はなしのタネ"'), html);
});

test('記事ページ以外では Ghost の meta_title ヘルパーの値だけを title に出力し、og:title は出力しない', () => {
    const html = 描画({post: undefined, metaTitle: 'はなしのタネ (Page 2)'});
    assert.ok(html.includes('<title>はなしのタネ (Page 2)</title>'), html);
    assert.ok(!html.includes('og:title'), html);
    assert.ok(!html.includes('twitter:title'), html);
});

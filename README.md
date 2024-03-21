# SPL Trader - Splinterlands Market Trading Bot

A market trading bot that listens to HIVE blockchain transactions to automatically buys and sells cards based on your bids.

Code is based on https://github.com/derfabsSL/Splinterbuyer

## How it works

The bot streams the HIVE blockchain and listens for new sell orders. You can set bids for specific cards, rarities or editions, and when the bot finds a listing that fits one of your bids, it buys the card automatically.

### Features

-   Fully automated lightning-fast buying (and selling) of cards
-   Filter by card id, rarity, edition, gold foil
-   You can configure how many cards the bot should buy
-   You don't have to compete against other bidders like on Peakmonsters Autobid
-   Can run 24/7
-   Can be used to convert CREDITS to DEC

## Installation

You can run the app using the Nodejs on local machine or run it inside a Docker container. Please follow the instructions bellow depanding on your choice.

### Run with Node

1. Download and install [Node.js](https://nodejs.org/) and [Git](https://git-scm.com/)
2. Install MongoDB locally or create a free account at [MongoDB.com](https://www.mongodb.com/)
3. Link your Splinterlands account to [monstercards.store](https://monstercards.store/ref/d1434763-5b3c-496d-9d5a-b82e8376cfc1) for receiving 3% cashback
4. Clone the repo via cmd (for Windows) or terminal (for Mac and Linux):

```sh
git clone https://github.com/sxirtla/SPL-Trader.git
```

5. Go to the repo directory

```sh
cd SPL-Trader
```

6. Rename config-example.json to config.json and fill in the data
7. Run following commands:

```sh
npm install
```

```sh
npm start
```

### Run with Docker

1. Download and install [Docker](https://docs.docker.com/get-docker/) and [Git](https://git-scm.com/)
2. Link your Splinterlands account to [monstercards.store](https://monstercards.store/ref/d1434763-5b3c-496d-9d5a-b82e8376cfc1) for receiving 3% cashback
3. Clone the repo via cmd (for Windows) or terminal (for Mac and Linux):

```sh
git clone https://github.com/sxirtla/SPL-Trader.git
```

4. Go to the repo directory

```sh
cd SPL-Trader
```

5. Rename config-example.json to config.json and fill in the data
6. Run following command:

```sh
docker compose up
```

## Config

The config.json file is where you can set the bot's parameters and specify your account info. An example file (config-example.json) is included in the folder.

#### global_params

1. `mongo_url`: Connection string for mongoDB that you have created in Installation step 2. or mongodb://splmongo if you want to use Docker

```
"mongo_url": "mongodb://localhost:27017",
```

or

```
"mongo_url": "mongodb://splmongo",
```

2. `min_profit_usd`: minimum profit for each trade in USD

```
"min_profit_usd": 0.01,
```

3. `profit_fee_pct`: This specifies what percent of your **profit** you want to donate. This happens only if the bot successfully resells a card.

```
"profit_fee_pct": 10
```

4. `fetch_market_price_delay`: This property specifies how often we will fetch market prices from Splinterlands API.

```
"fetch_market_price_delay": 5
```

5. `preferred_hive_node`: This is an optional property, it sets the node server for transactions. You can find the best server for you using this tool: https://peakd.com/me/benchmark

```
"preferred_hive_node": "https://api.hive.blog"
```

6. `min_dec_price`: This is an optional property, bot will not buy cards if dec is bellow provided price

```
"min_dec_price": "0.0009"
```

#### accounts

1. `account_name`: Your Splinterlands username, without the @

```
"altryx": { ... }
```

2. `currency`: Either "DEC" or "CREDITS", depending on how you want to buy

```
"currency": "DEC"
```

2. `minimum_balance`: how much balance you want to keep in your account

```
"minimum_balance": 5000
```

3. `active_key`: Your HIVE active key, this is never shared with anyone and only used to buy cards on the blockchain

```
"active_key": "your_active_key"",
```

3. `posting_key`: Your HIVE posting key, this is never shared with anyone and only used to delegate resource credits to your account

```
"posting_key": "your_posting_key"",
```

3. `rc_from`: optional - splinterlands account, which will be used to delegate resource credits to your account. Your account needs to have the posting authority over rc_from. You cand add this authority using https://peakd.com/@[rc_from_account]/permissions

```
"rc_from": "different_splinterlands_account",
```

3. `rc_amount_b`: optional - resource credits in billions.

```
"rc_amount_b": 10,
```

#### bids

1. `comment`: This field names your bids. You can write whatever you want here, the bot will ignore it.

```
"comment": "All cards"
```

2. `cards`: This specifies individual cards you want the bot to buy. For Example, to buy Chicken, you would put "131"
   If you fill in this field, all other ones will be ignored, you can leave them empty. See the example in config-example.json

Example, buy 5 1bcx chickens:

```
"cards": {
    "131": { "max_quantity": 5, "max_bcx": 1, "max_bcx_price": 1, "name": "chicken" }
}
```

3. `editions`: This specifies the editions the bot will filter for. The keys are as follows:
   `alpha`
   `beta`
   `promo`
   `reward`
   `untamed`
   `dice`
   `chaos`
   `rift`
   `rebel`

Example: only buy alpha, beta, promo, and untamed cards:

```
"editions": ["alpha","beta","promo","untamed"]
```

4. `rarities`: This specifies the rarities the bot will filter for, formatted by the IDs as they appear in the Splinterlands API. The keys are as follows:
   `common`
   `rare`
   `epic`
   `legendary`

Example, only buy epic and legendary cards:

```
"rarities": ["epic","legendary"]
```

5. `elements`: The bot can also filter for specific elements, like "fire", "death" or "dragon"
   The keys are:
   `fire`
   `water`
   `earth`
   `life`
   `death`
   `dragon`
   `neutral`

Example, filter for dragon cards only:

```
"elements": ["dragon"]
```

6. `types`: To filter for Summoners or Monsters. Values are:
   `summoner`
   `monster`

Example, buy only summoners:

```
"types": ["summoner"]
```

7. `max_bcx`: To buy only cards with a bcx less than or equal to this value. Also if you buy a lower bcx card, this value will be reduced and you will buy a total of max_bcx cards. If you don't specify the value or set it to 0, the bot will buy only level 1 cards.

```
"max_bcx": 5
```

8. `max_bcx_price`: How much to pay for each bcx. If max_bcx is specified this value will be multiplied by the card bcx.

Example, if the card is 5 bcx this value will be 5 \* 0.5 = 2.5 USD and the bot will spend 2.5 USD for this card.

```
"max_bcx_price": 0.5
```

9. `min_cp_per_usd`: To buy only cards with a specific CP/USD (Collection Power per USD)

Example, buy cards with CP/USD >= 200:

```
"min_cp_per_usd": 200
```

10. `max_quantity`: How many cards the bot should buy for this specific bid. max_quantity can't be less than max_bcx

Example, buy 5 cards:

```
"max_quantity": 5
```

11. `gold_only`: If this is set to true, the bot will only buy gold foil cards.

Example, buy only gold foil cards:

```
"gold_only": true
```

12. `only_modern`: This parameter is meant to be paired with filtering for Reward and Promo Edition cards, because these cards cannot be filtered by edition, If this is set to true, the bot will NOT buy modern cards.

Example, buy only modern cards:

```
"only_modern": true
```

13. `sell_for_pct_more`: If you want the bot to put the cards on the market immediately after buying, you can use this parameter. The bot will sell the card for x percent more than the buy price. For example, if the card is bought for 10$ and "sell_for_pct_more" is set to 10, the bot will list the card for 11$
    **If you don't want the bot to sell automatically, leave this parameter at 0**

Example, sell for 10% higher than buy price:

```
"sell_for_pct_more": 10
```

Example 2, don't sell cards:

```
"sell_for_pct_more": 0
```

14. `auto_set_buy_price`: If this is set to true, the bot will check current market prices and bid accordingly, to buy underpriced cards.

```
"auto_set_buy_price": "true"
```

15. `buy_pct_below_market`: Use this parameter in combination with "auto_set_buy_price":true
    This specifies how many percent below the market price the bot should buy.
    **This is only active if "auto_set_buy_price":true**

Example, buy 10% below the current market price:

```
"buy_pct_below_market": 10
```

## Are my Keys Safe?

Your keys are only used to sign blockchain transactions for buying cards and will never leave your computer.
The bot needs your active key to be able to make purchases independently without needing confirmation for every purchase.
The code for this bot is open source, so you can see for yourself where the key is used and what for.
Also, I recommend using alt accounts, where you don't have many assets, for trading. You can use the Main account for rc delegation, using the accouns.rc_from option.

## Support

[telegram](https://web.telegram.org/a/#-4103909686)

## Donations

If you wish to buy me a beer 🍺 I'll appreciate it:

-   Splinterlands / Hive account `@altryx`
-   Ethereum 0x2f2812De52F28476ab8086A5C708a077681bF379
-   BSC 0x2f2812De52F28476ab8086A5C708a077681bF379
-   WAX to account `vm.bc.wam`

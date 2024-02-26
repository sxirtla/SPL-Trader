import { GlobalParams } from '../types/trade';
import { sleep } from '../utility/helper';
import * as hive from './hive';

const manage_rc = async (acc: string, config: GlobalParams) => {
    let rc_mana = await hive.getRCMana(acc);
    let rcFrom = config.accounts[acc].rc_from;
    let rcAmountB = config.accounts[acc].rc_amount_b;
    if (rc_mana < 1 && rcFrom && rcAmountB) {
        await hive.delegateRC(rcFrom, acc, 0);
        await sleep(5000);
        await hive.delegateRC(rcFrom, acc, rcAmountB * 1000000000);
    }
}

export { manage_rc };
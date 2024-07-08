# revert error code in contracts


| Code |  Message  |
| :----: | :---------- |
| E01 | only owner |
| E02 | only admin |
| E03 | only pending admin |
| E04 | Address: insufficient balance |
| E05 | Address: unable to send value, recipient may have reverted |
| E06 | Already operated |
| E07 | Validator already exists |
| E08 | Validator not exists |
| E09 | invalid address |
| E10 | should be both zero or both non-zero |
| E11 | invalid total rewards and bonus |
| E12 | zero epoch |
| E13 | only on genesis |
| E14 | invalid stake |
| E15 | invalid initial params |
| E16 | already permission-less |
| E17 | only block epoch |
| E18 | empty validators set |
| E19 | only RewardsUpdateEpoch block |
| E20 | need minimal self stakes on permission-less stage |
| E21 | admin only on permission stage |
| E22 | founder locking |
| E23 | the input _deltaEth should not be zero |
| E24 | no enough stake to subtract/unbind |
| E25 | staking amount must >= 1 StakeUnit |
| E26 | staking amount must must be an integer multiples of ether |
| E27 | A valid commission rate must in the range [ 0 , 100 ] |
| E28 | can't do staking at current state |
| E29 | total stakes will break max limit |
| E30 | slash amount from pending is not correct |
| E31 | Break minSelfStakes limit, try exitStaking |
| E32 | already on the exit state |
| E33 | validator do not accept delegation |
| E34 | no delegation |
| E35 | For validator, the staking rewards greater then zero, but the totalStake is zero, it should be a bug |
| E40 | only miner |
| E41 | already initialized |
| E42 | not initialized |
|     |  |
| M01 | SafeMath: addition overflow |
| M02 | SafeMath: subtraction overflow |
| M03 | SafeMath: multiplication overflow |
| M04 | SafeMath: division by zero |
| M05 | SafeMath: modulo by zero |

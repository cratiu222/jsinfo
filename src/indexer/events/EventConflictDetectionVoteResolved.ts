import { Event } from "@cosmjs/stargate"
import { LavaBlock } from "../types";
import * as JsinfoSchema from '../../schemas/jsinfo_schema';
import { GetOrSetProvider, SetTx } from "../setLatest";
import { EventProcessAttributes, EventParseProviderAddress, EventParseInt } from "../eventUtils";

/*
*/

export const ParseEventConflictDetectionVoteResolved = (
  evt: Event,
  height: number,
  txHash: string | null,
  lavaBlock: LavaBlock,
  static_dbProviders: Map<string, JsinfoSchema.Provider>,
  static_dbSpecs: Map<string, JsinfoSchema.Spec>,
  static_dbPlans: Map<string, JsinfoSchema.Plan>,
  static_dbStakes: Map<string, JsinfoSchema.ProviderStake[]>,
) => {
  const dbEvent: JsinfoSchema.InsertEvent = {
    tx: txHash,
    blockId: height,
    eventType: JsinfoSchema.LavaProviderEventType.DetectionVoteResolved,
    consumer: null,
    provider: null,
  }

  if (!EventProcessAttributes({
    caller: "ParseEventConflictDetectionVoteResolved",
    lavaBlock: lavaBlock,
    evt: evt,
    height: height,
    txHash: txHash,
    dbEvent: dbEvent,
    processAttribute: (key: string, value: string) => {
      switch (key) {
        case 'voteID':
          dbEvent.t1 = value
          break
        case 'winner':
          dbEvent.provider = EventParseProviderAddress(value)
          break

        case 'NumOfNoVoters':
          dbEvent.i1 = EventParseInt(value) // len https://github.com/lavanet/lava/blob/main/x/conflict/keeper/vote.go#L135
          break
        case 'NumOfVoters':
          dbEvent.i2 = EventParseInt(value) // leb
          break

        case 'RewardPool':
          dbEvent.b1 = EventParseInt(value)
          break
        case 'TotalVotes':
          dbEvent.b2 = EventParseInt(value) // stake
          break

        /*case 'FirstProviderVotes':
          dbEvent.b1 = EventParseInt(value) // stake
          break
        case 'NoneProviderVotes':
          dbEvent.b2 = EventParseInt(value) // stake
          break
        case 'SecondProviderVotes':
          dbEvent.b2 = EventParseInt(value)
          break*/
      }
    },
    verifyFunction: () => !!dbEvent.provider
  })) return;

  SetTx(lavaBlock.dbTxs, txHash, height)
  GetOrSetProvider(lavaBlock.dbProviders, static_dbProviders, dbEvent.provider!, '')
  lavaBlock.dbEvents.push(dbEvent)
}
export interface AnnouncementMutationInput {
  title: string;
  content: string;
  isPublished?: boolean;
  effectiveFrom?: string;
  effectiveTo?: string;
  publisherAccountId?: number;
}

export interface StationMessageInput {
  title: string;
  content: string;
  receiverAccountIds?: number[];
  senderAccountId?: number;
  isBroadcast?: boolean;
}

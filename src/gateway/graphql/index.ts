import { ApolloServer, gql, IResolvers } from "apollo-server-lambda";
import { APIGatewayEvent, Context as LambdaContext } from "aws-lambda";
import { getConnectionPool } from "../../database/postgres";
import { query } from "../../database/transaction-db";
import { createRouter, APIHandler } from "../../lib/api-handler";
import { TransactionHeader, utf8DecodeTag } from "../../lib/arweave";
import graphqlFields from "graphql-fields";

const typeDefs = gql`
  type Query {
    transaction(id: ID!): Transaction
    transactions(
      from: [String!]
      to: [String!]
      tags: [TagInput!]
    ): [Transaction!]!
    countTransactions(from: [String!], to: [String!], tags: [TagInput!]): Int!
  }

  type Transaction {
    id: ID!
    tags: [Tag!]!
    tagValue(tagName: String!): String
    linkedToTransaction(byOwnTag: String!): Transaction
    linkedFromTransactions(
      byForeignTag: String!
      from: [String!]
      to: [String!]
      tags: [TagInput!]
    ): [Transaction!]!
    countLinkedFromTransactions(
      byForeignTag: String!
      from: [String!]
      to: [String!]
      tags: [TagInput!]
    ): Int!
  }

  type Tag {
    name: String!
    value: String!
  }

  input TagInput {
    name: String!
    value: String!
  }
`;

const resolvers: IResolvers | Array<IResolvers> = {
  Query: {
    transaction: (
      root: any,
      { id, to, from, tags }: any,
      context: any,
      info: any
    ) => {
      const pool = getConnectionPool("read");
      return query(pool, {
        id,
      });
    },
    transactions: async (root, { to, from, tags }, context, info) => {
      const pool = getConnectionPool("read");

      const fields = graphqlFields(info as any);

      const sqlQuery = query(pool, {
        to,
        from,
        tags,
        select: fields.tags
          ? ["transactions.id", "transactions.tags"]
          : ["transactions.id"],
      });

      console.log(sqlQuery.toSQL());

      const results = (await sqlQuery) as TransactionHeader[];

      return results.map(({ id, tags = [] }: Partial<TransactionHeader>) => {
        return {
          id,
          tags: tags.map(utf8DecodeTag),
        };
      });
    },
  },
};

const server = new ApolloServer({
  typeDefs,
  resolvers,
});

const apolloHandler = server.createHandler({});

const router = createRouter();

export const graphqlHandler: APIHandler = async (request, response) => {
  return new Promise((resolve, reject) => {
    apolloHandler(
      {
        //@ts-ignore
        ...request.app._event,
        body: JSON.stringify(request.body),
      },
      request.context,
      (error, result) => {
        if (error) {
          reject(error);
        }

        if (result) {
          if (result.statusCode) {
            response.status(result.statusCode);
          }

          if (result.headers) {
            Object.keys(result.headers).forEach((header) => {
              const value = result.headers![header];
              response.header(header, "" + value || "");
            });
            resolve(result.body);
          }
        }
        reject();
      }
    );
  });
};

router.any(graphqlHandler);

export const handler = async (
  event: APIGatewayEvent,
  context: LambdaContext,
  callback: (err: Error, result: any) => void
) => {
  return router.run(event, context, callback);
};

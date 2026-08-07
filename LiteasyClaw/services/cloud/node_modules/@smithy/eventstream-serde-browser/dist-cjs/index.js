"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readableStreamtoIterable = exports.iterableToReadableStream = exports.eventStreamSerdeProvider = exports.EventStreamMarshaller = void 0;
const event_streams_1 = require("@smithy/core/event-streams");
var event_streams_2 = require("@smithy/core/event-streams");
Object.defineProperty(exports, "EventStreamMarshaller", { enumerable: true, get: function () { return event_streams_2.EventStreamMarshaller; } });
Object.defineProperty(exports, "eventStreamSerdeProvider", { enumerable: true, get: function () { return event_streams_2.eventStreamSerdeProvider; } });
Object.defineProperty(exports, "iterableToReadableStream", { enumerable: true, get: function () { return event_streams_2.iterableToReadableStream; } });
exports.readableStreamtoIterable = event_streams_1.readableStreamToIterable;

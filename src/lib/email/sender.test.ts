import { afterEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-sesv2", () => ({
  // Must be a real `function`, not an arrow function — arrow functions
  // aren't constructible, and sender.ts calls `new SESv2Client(...)`.
  SESv2Client: vi.fn().mockImplementation(function SESv2Client() {
    return { send: sendMock };
  }),
  SendEmailCommand: vi.fn().mockImplementation(function SendEmailCommand(input: unknown) {
    return input;
  }),
}));

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  sendMock.mockReset();
  vi.resetModules();
});

describe("sendEmail", () => {
  it("falls back to console.log when AWS_REGION/SES_FROM_EMAIL are unset", async () => {
    delete process.env.AWS_REGION;
    delete process.env.SES_FROM_EMAIL;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { sendEmail } = await import("./sender");
    await sendEmail({ to: "a@example.test", subject: "Hi", body: "Body" });

    expect(sendMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("calls SES with the expected input when configured", async () => {
    process.env.AWS_REGION = "us-east-1";
    process.env.SES_FROM_EMAIL = "noreply@example.test";
    sendMock.mockResolvedValueOnce({});

    const { sendEmail } = await import("./sender");
    await sendEmail({ to: "member@example.test", subject: "Hi", body: "Body text" });

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toMatchObject({
      FromEmailAddress: "noreply@example.test",
      Destination: { ToAddresses: ["member@example.test"] },
      Content: { Simple: { Subject: { Data: "Hi" }, Body: { Text: { Data: "Body text" } } } },
    });
  });

  it("swallows a rejected send instead of throwing", async () => {
    process.env.AWS_REGION = "us-east-1";
    process.env.SES_FROM_EMAIL = "noreply@example.test";
    sendMock.mockRejectedValueOnce(new Error("SES throttled"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { sendEmail } = await import("./sender");
    await expect(
      sendEmail({ to: "member@example.test", subject: "Hi", body: "Body" }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { google } = require('googleapis');
const { readFileSync } = require('fs');
require('dotenv').config();

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = {
  run: async ({ interaction }) => {
    const modal = new ModalBuilder()
      .setCustomId(`myModal-${interaction.user.id}`)
      .setTitle('Marketing');

    const projectNameInput = new TextInputBuilder()
      .setCustomId('projectNameInput')
      .setLabel("What's your project name?")
      .setStyle(TextInputStyle.Short)
      .setMaxLength(80);

    const describeInput = new TextInputBuilder()
      .setCustomId('describeInput')
      .setLabel("Please describe the marketing request.")
      .setStyle(TextInputStyle.Paragraph);

    const deadlineInput = new TextInputBuilder()
      .setCustomId('deadlineInput')
      .setLabel("What's the deadline (dd-mm-yyyy)?")
      .setStyle(TextInputStyle.Short);

    const firstActionRow = new ActionRowBuilder().addComponents(projectNameInput);
    const secondActionRow = new ActionRowBuilder().addComponents(describeInput);
    const thirdActionRow = new ActionRowBuilder().addComponents(deadlineInput);

    modal.addComponents(firstActionRow, secondActionRow, thirdActionRow);

    await interaction.showModal(modal);

    // Wait for modal to be submitted
    const filter = (i) => i.customId === `myModal-${interaction.user.id}`;
    interaction.awaitModalSubmit({ filter, time: 3600000 })
      .then(async (modalInteraction) => {
        await modalInteraction.deferReply({ ephemeral: true });
        const projectNameValue = modalInteraction.fields.getTextInputValue('projectNameInput');
        const describeValue = modalInteraction.fields.getTextInputValue('describeInput');
        const deadlineValue = modalInteraction.fields.getTextInputValue('deadlineInput');

        // Validate the deadline format
        const deadlineFormatRegex = /^\d{2}-\d{2}-\d{4}$/;
        if (!deadlineFormatRegex.test(deadlineValue)) {
          await modalInteraction.followUp({ content: 'The deadline must be in the format of dd-mm-yyyy. Please try again.', ephemeral: true });
          return;
        }

        // Check if the project name exceeds 80 characters
        if (projectNameValue.length > 80) {
          await modalInteraction.followUp({ content: 'The project name must not exceed 80 characters. Please try again.', ephemeral: true });
          return; // Stop further execution if the project name is too long
        }

        // Parse the deadline to create a JavaScript Date object
        const [day, month, year] = deadlineValue.split('-');
        const deadlineDate = new Date(year, month - 1, day, 23, 59, 59); // Set the end of the day for the deadline

        // Get the current date and time
        const currentDate = new Date();

        // Check if the deadline is in the past
        if (deadlineDate <= currentDate) {
          await modalInteraction.followUp({
            content: 'The deadline must be a future date. Please try again.',
            ephemeral: true
          });
          return; // Stop further execution
        }

        // Validate total input length to avoid exceeding Discord's message limit
        const totalLength = `Project: ${projectNameValue}\nYour description: ${describeValue}\nDeadline: ${deadlineValue}`.length;
        if (totalLength > 3900) { // 3900 to leave room for formatting
          await modalInteraction.followUp({
            content: 'The combined length of your inputs is too long. Please reduce the length of your inputs, particularly the project description.',
            ephemeral: true
          });
          return;
        }

        // Create a thread with the project name and deadline as the title, including an "X" emoji to indicate it's not done
        const thread = await interaction.channel.threads.create({
          name: `❌ ${projectNameValue} - ${deadlineValue}`,
          autoArchiveDuration: 10080, // This can be 60, 1440, 4320, 10080 (minutes) depending on your server settings
          reason: 'To discuss the marketing project deadline',
        });

        // Send the modal output as the first message in the thread
        await thread.send(`Project: ${projectNameValue}\nYour description: ${describeValue}\nDeadline: ${deadlineValue}`);

        try {
          // Read and parse the Google service account credentials
          const creds = JSON.parse(readFileSync(process.env.GOOGLE_SHEETS_CREDENTIALS_PATH, 'utf8'));
          
          // Initialize JWT client for Google authentication
          const { JWT } = require('google-auth-library');
          const serviceAccountAuth = new JWT({
              email: creds.client_email,
              key: creds.private_key.replace(/\\n/g, '\n'),
              scopes: [
                  'https://www.googleapis.com/auth/spreadsheets',
                  'https://www.googleapis.com/auth/calendar'
              ],
          });

          // Initialize GoogleSpreadsheet instance with the sheet ID and auth client
          const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

          await doc.loadInfo(); // Load the document properties and worksheets

          const sheet = doc.sheetsByIndex[0]; // Use the first sheet

          // Initialize the Google Calendar API
          const calendar = google.calendar({version: 'v3', auth: serviceAccountAuth});
          
          // Determine the current date for the event start
          const currentDate = new Date();
          
          // Ensure the event spans from the current date to the deadline
          const event = {
            summary: `Marketing Project: ${projectNameValue}`,
            description: `Project: ${projectNameValue}\nDescription: ${describeValue}\nDeadline: ${deadlineValue}`,
            start: {
              dateTime: currentDate.toISOString(), // Start date is the current date
              timeZone: 'GMT+01:00', // Adjust the time zone as needed
            },
            end: {
              dateTime: deadlineDate.toISOString(), // End date is the deadline date
              timeZone: 'GMT+01:00', // Adjust the time zone as needed
            },
            // Add more event details if needed
          };
          
          let calendarEventId = ''; // Variable to store the calendar event ID
          
          // Insert the event into the calendar using await with the promise returned by calendar.events.insert
          try {
            const eventResponse = await calendar.events.insert({
              calendarId: process.env.GOOGLE_CALENDAR_ID, // Use environment variable
              resource: event,
            });

            console.log(`Event created: ${eventResponse.data.htmlLink}`);
            calendarEventId = eventResponse.data.id; // Correctly assign the event ID here
            await thread.send(`View the calendar event: <${eventResponse.data.htmlLink}>`);
          } catch (err) {
            console.log(`There was an error contacting the Calendar service: ${err}`);
            await thread.send('There was an error creating the calendar event.');
            return;
          }

          // Log the data including the username and thread ID
          const username = modalInteraction.user.username;
          const channelName = interaction.channel.name;
          const threadId = thread.id; // Capture the thread ID
          
          console.log('Writing data to Google Sheets:', {
            Username: username,
            ChannelName: channelName,
            Project: projectNameValue,
            Description: describeValue,
            Deadline: deadlineValue,
            ThreadID: threadId, // Include the thread ID in the log
            CalendarEventId: calendarEventId, // Use the calendar event ID
            Timestamp: new Date().toLocaleString(),
          });
          
          // Add a row with the modal output including the username, thread ID, and calendar event ID
          await sheet.addRow({
            Username: username,
            ChannelName: channelName,
            Project: projectNameValue,
            Description: describeValue,
            Deadline: deadlineValue,
            ThreadID: threadId, // Add the thread ID here
            CalendarEventId: calendarEventId, // Add the calendar event ID here
            Timestamp: new Date().toLocaleString(),
            Completed: 'No',
          });
          
          console.log('Data recorded to Google Sheets successfully.');
          
          await modalInteraction.followUp('Success. See thread below.');
        } catch (err) {
            console.error('Error writing to Google Sheets:', err);
            await modalInteraction.followUp('There was an error recording your data. Please try again.');
        }
      })
      .catch(async (error) => {
        if (error.code === 'INTERACTION_COLLECTOR_ERROR') {
          console.error('Modal was not filled in time:', error);
          await interaction.followUp({ content: 'You did not respond in time. Please try again.', ephemeral: true });
        } else {
          console.error('Error handling modal submission:', error);
          await interaction.followUp({ content: 'There was an issue handling your request.', ephemeral: true });
        }
      });
  },
  
  data: {
    name: 'marketingthread',
    description: 'Shows a modal for marketing requests!',
  },
};
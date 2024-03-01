const { GoogleSpreadsheet } = require('google-spreadsheet');
const { readFileSync } = require('fs');
require('dotenv').config();
const { JWT } = require('google-auth-library');

module.exports = {
  run: async ({ interaction, args }) => {
    // Check if the interaction is within a thread
    if (!interaction.channel.isThread()) {
      await interaction.reply({ content: 'This command can only be used within a thread.', ephemeral: true });
      return;
    }

    // Check if a deadline was provided
    let newDeadline = interaction.options.getString('deadline');
    if (!newDeadline) {
      // Immediately reply that a deadline is required
      await interaction.reply({ content: 'You didn\'t fill in a deadline.', ephemeral: true });
      return;
    }

    // Immediately defer the reply to buy time
    await interaction.deferReply({ ephemeral: true });

    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const hasRole = member.roles.cache.has(process.env.TEAM_ROLE_ID);
      
      if (!hasRole) {
        // Edit the original deferred reply with an error message
        await interaction.editReply({ content: 'You do not have permission to use this command.' });
        return;
      }

      const creds = JSON.parse(readFileSync(process.env.GOOGLE_SHEETS_CREDENTIALS_PATH, 'utf8'));
      const serviceAccountAuth = new JWT({
        email: creds.client_email,
        key: creds.private_key.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/calendar'],
      });

      const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);
      await doc.loadInfo();
      const sheet = doc.sheetsByIndex[0]; // Use the first sheet

      const threadId = interaction.channelId; // Get the thread ID

      const rows = await sheet.getRows();

      // Find the row with the matching thread ID
      const rowToEdit = rows.find(row => row._rawData[7] === threadId);

      if (rowToEdit) {
        rowToEdit._rawData[2] = newDeadline; // Update the deadline in the sheet
        await rowToEdit.save();
        // Edit the original deferred reply with the success message
        await interaction.editReply(`The deadline has been updated to ${newDeadline}.`);

        // Update the calendar event
        const calendarEventId = rowToEdit._rawData[10]; // CalendarEventId from column K (index 10)
        const {google} = require('googleapis');
        const calendar = google.calendar({version: 'v3', auth: serviceAccountAuth});

        // Function to transform the date from DD-MM-YYYY to a Date object
        function parseDate(input) {
          console.log(`Parsing date from input: ${input}`); // Log the input date format
          const parts = input.split('-');
          if (parts.length === 3) {
            const date = new Date(parts[2], parts[1] - 1, parts[0]); // Note: months are 0-based
            console.log(`Transformed into Date object: ${date.toISOString()}`); // Log the output date format
            return date;
          }
          console.log('Invalid date format encountered.'); // Log when an invalid format is encountered
          return null; // Return null if the format is incorrect
        }

        // Assuming newDeadline is in DD-MM-YYYY format
        const newEndDate = parseDate(newDeadline);
        if (!newEndDate) {
          console.error('Invalid date format');
          await interaction.editReply('Invalid date format. Please use DD-MM-YYYY.');
          return;
        }

        try {
          // Fetch the calendar event
          const event = await calendar.events.get({
            calendarId: process.env.GOOGLE_CALENDAR_ID,
            eventId: calendarEventId,
          });

          // Keep the start date as is, only change the end date
          const startDate = event.data.start.date || event.data.start.dateTime;
          // Ensure the end date is in dateTime format with time set to 12:00
          const endDate = new Date(newEndDate.setHours(12, 0, 0, 0)).toISOString();

          // Update the event's end dateTime to match the start format
          if (event.data.start.dateTime) {
            event.data.end.dateTime = endDate;
            event.data.end.timeZone = event.data.start.timeZone; // Ensure timezone consistency
          } else {
            // If the original event used date-only format, adjust accordingly
            event.data.end.date = newEndDate.toISOString().split('T')[0];
          }

          // Optionally, update the event's description to include the new deadline
          event.data.description = `Deadline updated to ${newDeadline}.`;

          // Save the updated event
          await calendar.events.update({
            calendarId: process.env.GOOGLE_CALENDAR_ID,
            eventId: calendarEventId,
            requestBody: event.data,
          });

          console.log('Calendar event updated successfully.');

          // After updating the deadline in Google Sheets and Google Calendar,
          // attempt to update the thread name
          const thread = await interaction.guild.channels.resolve(threadId);
          if (thread && thread.isThread()) {
            try {
              // Extract the project name by splitting the thread name and removing the last part (assuming the last part is the deadline)
              let threadNameParts = thread.name.split(" - ");
              // Remove the last part (the old deadline) and keep the rest as the project name
              let projectName = threadNameParts.slice(0, -1).join(" - ").trim();
              // Construct the updated thread name with the new deadline
              let updatedThreadName = `${projectName} - ${newDeadline}`;

              console.log(`Attempting to update thread name to: ${updatedThreadName}`);
              await thread.setName(updatedThreadName, 'Updating deadline...');
              console.log('Thread name updated successfully.');
            } catch (error) {
              console.error('Error updating thread name:', error);
            }
          } else {
            console.log('The resolved channel is not a thread or could not be found.');
          }
        } catch (error) {
          console.error('Error updating calendar event:', error);
        }
      } else {
        // Edit the original deferred reply with the error message
        await interaction.editReply('No matching row found for this thread.');
      }
    } catch (err) {
      console.error('Error updating Google Sheets:', err);
      // Edit the original deferred reply with the error message
      await interaction.editReply('There was an error updating the data. Please try again.');
    }
  },

  data: {
    name: 'change-deadline',
    description: 'Updates deadline in Google Sheet and Google Calendar for the thread ID.',
    options: [
      {
        name: 'deadline',
        type: 3, // STRING type
        description: 'The new deadline to set',
        required: true, // Set to true if you want this to be a required field
      },
    ],
  },
};
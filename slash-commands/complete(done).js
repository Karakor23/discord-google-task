const { GoogleSpreadsheet } = require('google-spreadsheet');
const { readFileSync } = require('fs');
require('dotenv').config();
const { JWT } = require('google-auth-library');

module.exports = {
  run: async ({ interaction, args }) => {
    // Ensure this is a guild interaction and within a thread
    if (!interaction.guild || !interaction.channel.isThread()) {
      await interaction.reply({ content: 'This command can only be used within a thread in a guild.', ephemeral: true });
      return;
    }

    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const hasRole = member.roles.cache.has(process.env.TEAM_ROLE_ID);
      
      if (!hasRole) {
        await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
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

      // Find the row with the matching thread ID in column H (index 7)
      const rowToEdit = rows.find(row => row._rawData[7] === threadId);

      if (rowToEdit) {
        rowToEdit._rawData[6] = "Yes"; // Update column G (index 6) with "Yes"
        await rowToEdit.save();
        await interaction.reply('The thread has been marked as completed.');

        // Update the calendar event to reflect completion
        const calendarEventId = rowToEdit._rawData[10]; // Get the CalendarEventId from column K (index 10)
        const {google} = require('googleapis');
        const calendar = google.calendar({version: 'v3', auth: serviceAccountAuth});

        try {
          // Fetch the calendar event
          const event = await calendar.events.get({
            calendarId: process.env.GOOGLE_CALENDAR_ID,
            eventId: calendarEventId,
          });

          // Update the event's title to indicate completion
          event.data.summary = `${event.data.summary} - Completed`;

          // Save the updated event
          await calendar.events.update({
            calendarId: process.env.GOOGLE_CALENDAR_ID,
            eventId: calendarEventId,
            requestBody: event.data,
          });

          console.log('Calendar event marked as completed.');
        } catch (error) {
          console.error('Error updating calendar event:', error);
        }

        // After all operations are complete, before archiving the thread
        const thread = await interaction.guild.channels.resolve(threadId);
        if (thread && thread.isThread()) {
          // This approach uses a regular expression to remove any leading emoji characters from the thread name
          // It then prepends the green checkmark emoji to the cleaned name
          const currentThreadName = thread.name;
          const newThreadName = currentThreadName.replace(/❌|⏳/, '✅');
          console.log(`Attempting to rename thread. Current name: ${currentThreadName}, New name: ${newThreadName}`); // Log the name change attempt
          await thread.setName(newThreadName, 'Marking the thread as completed.'); // Rename the thread
          console.log('Thread name changed successfully.'); // Log successful name change

          // Now archive the thread
          await thread.setArchived(true, 'The thread has been marked as completed.');
          console.log('Thread archived successfully.');
        }
      } else {
        await interaction.reply('No matching row found for this thread.');
      }
    } catch (err) {
      console.error('Error updating Google Sheets or Calendar:', err);
      await interaction.reply('There was an error updating the data. Please try again.');
    }
  },

  data: {
    name: 'complete',
    description: 'Marks the thread as completed in the Google Sheet and updates the calendar event accordingly.',
    options: [], // No options needed for this command
  },
};